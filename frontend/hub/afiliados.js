// Afiliados (#/afiliados, 03 · Negócios; 3 nov 2026, Marco: «affiliate market... quero funcional... ainda estou a entrar nesse
// nicho, simplifica, dá exemplos, mostra provas»). Quatro vistas na mesma página:
//   Os meus programas: os programas da equipa (link, comissão, cookie, estado) e o que cada um deu, escrito à mão a partir do painel
//     da rede até haver uma rede ligada por API (routers/affiliates.py, vai por sync). Só números escritos: sem registo, «Sem dados».
//   Como funciona: o negócio em quatro passos, os três tipos de comissão e as palavras do meio.
//   Calculadora: visitas × cliques × compras × comissão, com exemplos reais (estimativa, dita como tal).
//   Provas: casos públicos com a fonte ao lado. Segue docs/hub-paginas.md; classes af-.
(function () {
  let D = null, view = "", timer = 0, exF = "todos", exOpen = "";
  const VIEWS = [["vender", "Como vender"], ["exemplos", "Exemplos · Natal"], ["meus", "Os meus programas"], ["como", "Como funciona"], ["calc", "Calculadora"], ["provas", "Provas"]];
  const STATUS = [["ideia", "Ideia"], ["candidatura", "Candidatura"], ["aprovado", "Aprovado"], ["ativo", "Ativo"], ["parado", "Parado"]];
  const TONE = { ideia: "off", candidatura: "wait", aprovado: "ai", ativo: "ok", parado: "bad" };
  const KINDS = [["pct", "% da venda"], ["fixed", "€ fixo por venda"], ["recurring", "% todos os meses"]];
  const pref = {
    get(k, d) { try { return localStorage.getItem(`af.${k}`) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`af.${k}`, v); } catch {} },
  };
  const eur = (v, dec = 0) => `${Number(v || 0).toLocaleString("pt-PT", { minimumFractionDigits: dec, maximumFractionDigits: dec })} €`;
  const int = (v) => Math.round(v || 0).toLocaleString("pt-PT");
  const comm = (p) => (p.kind === "fixed" ? `${eur(p.commission, p.commission % 1 ? 2 : 0)} ${t("por venda")}`
    : p.kind === "recurring" ? `${String(p.commission).replace(".", ",")}% ${t("por mês")}` : `${String(p.commission).replace(".", ",")}% ${t("da venda")}`);
  const svg = (d) => `<svg class="i" viewBox="0 0 24 24">${d}</svg>`;
  const I = {
    x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    copy: svg('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
    out: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>'),
    you: svg('<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>'),
    link: svg('<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>'),
    cart: svg('<path d="M3 4h2l2.4 11h11L21 7H6.2"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>'),
    coin: svg('<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.6-.8-1.6-1.2-2.8-1.2-1.7 0-2.8.9-2.8 2s1 1.6 2.8 2 2.8.9 2.8 2-1.1 2-2.8 2c-1.2 0-2.3-.5-2.9-1.3M12 6.5V8M12 16v1.5"/>'),
    arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  };

  // ---------------------------------------------------------------- conteúdo (fontes verificadas a 3 nov 2026)
  const PROVAS = [
    { big: "30 M$", who: "Wirecutter", what: "O New York Times comprou em 2016 um site de análises de produtos por cerca de 30 milhões de dólares. O site vivia sobretudo de comissões de afiliado: recomendava o melhor aspirador, a melhor mochila, e ganhava em cada compra feita pelo link.",
      lesson: "Um site de recomendações honestas pode valer milhões.", src: "CNN Money, 24 out 2016", url: "https://money.cnn.com/2016/10/24/media/the-new-york-times-buys-wirecutter" },
    { big: "687,6 M$", who: "NerdWallet", what: "Empresa cotada em bolsa que compara cartões de crédito, seguros e empréstimos. Ganha quando alguém escolhe um produto através dela. Receita de 2024: 687,6 milhões de dólares (+15% do que em 2023).",
      lesson: "Comparar produtos e mandar clientes é um negócio de bolsa.", src: "Resultados oficiais 2024 (investidores NerdWallet)", url: "https://investors.nerdwallet.com/news-releases/news-release-details/nerdwallet-reports-fourth-quarter-and-full-year-2024-results" },
    { big: "105 619 $", who: "Pat Flynn · Smart Passive Income", what: "Publicou durante anos quanto ganhava. Em dezembro de 2017, num só mês, 105 619 $ vieram de afiliados (cerca de 63% do total), sobretudo de ferramentas que ele próprio usava e ensinava a usar.",
      lesson: "Recomendar as ferramentas que usas, a quem está a aprender, rende.", src: "Relatório de dezembro de 2017", url: "https://www.smartpassiveincome.com/my-december-2017-monthly-income-report/" },
    { big: "12–18%", who: "FundedNext (o teu mundo)", what: "A prop firm onde já negoceias paga 12% da compra de cada conta no nível de entrada, 15% e 18% nos níveis de cima, e 10% recorrente nos futuros. O link fica válido 90 dias segundo um site de terceiros.",
      lesson: "Tu já tens a audiência certa: traders.", src: "Centro de ajuda FundedNext", url: "https://help.fundednext.com/en/articles/8020082-does-fundednext-have-an-affiliate-program" },
    { big: "200 $", who: "Semrush", what: "Ferramenta de SEO que paga 200 $ por cada assinatura nova do SEO Toolkit (e 10 $ por cada teste grátis), segundo a página oficial do programa.",
      lesson: "Software paga valores fixos altos por cliente.", src: "Página do programa Semrush", url: "https://www.semrush.com/lp/affiliate-program/en/" },
    { big: "até 60%", who: "Hostinger", what: "Alojamento de sites que anuncia até 60% de comissão por venda. Encaixa nos sites que vocês já fazem (Ten Fold, escolas, empresas locais): cada cliente precisa de alojamento.",
      lesson: "Junta comissão ao trabalho que já fazes.", src: "Hostinger, programa de afiliados", url: "https://www.hostinger.com/affiliates" },
    { big: "1–10%", who: "Amazon (Amazon.es)", what: "O programa mais fácil de entrar, mas paga pouco: tabelas de terceiros dão de 1% a 10% conforme a categoria (beleza de luxo no topo, eletrónica em baixo). Confirmar a tabela no painel do programa da Amazon.es.",
      lesson: "Fácil para começar, precisa de muito tráfego.", src: "Afiliados Amazon.es", url: "https://afiliados.amazon.es/" },
  ];
  const EXEMPLOS = [
    { id: "prop", name: "Prop firm (FundedNext)", visits: 3000, ctr: 8, conv: 3, price: 500, kind: "pct", c: 12, note: "Conta de ~500 € (estimado) a 12%: ~60 € por venda." },
    { id: "host", name: "Alojamento (Hostinger)", visits: 2000, ctr: 6, conv: 4, price: 60, kind: "pct", c: 60, note: "Plano anual de ~60 € (estimado) a 60%: ~36 € por venda." },
    { id: "saas", name: "Software (Semrush)", visits: 1500, ctr: 5, conv: 2, price: 0, kind: "fixed", c: 185, note: "200 $ fixos por assinatura (~185 €)." },
    { id: "amz", name: "Amazon.es", visits: 5000, ctr: 10, conv: 5, price: 40, kind: "pct", c: 4, note: "Compra média de 40 € a 4%: 1,60 € por venda." },
  ];
  const IDEIAS = [
    { name: "FundedNext", niche: "Trading", network: "Programa próprio", kind: "pct", commission: 12, cookie_days: 90, link: "https://fundednext.com/affiliate",
      why: "Já negoceias na FundedNext e tens o Painel no Hub: mostrar as tuas contas e regras é conteúdo pronto. Cuidado: produto de risco, diz sempre que se pode perder dinheiro." },
    { name: "Hostinger", niche: "Sites", network: "Programa próprio", kind: "pct", commission: 60, cookie_days: 30, link: "https://www.hostinger.com/affiliates",
      why: "Cada site que a equipa faz precisa de alojamento. Recomendar com o vosso link dá comissão por cima do trabalho que já é pago." },
    { name: "Semrush", niche: "Marketing / SEO", network: "Impact", kind: "fixed", commission: 185, cookie_days: 120, link: "https://www.semrush.com/lp/affiliate-program/en/",
      why: "Para quem vende sites e SEO: um tutorial ou uma auditoria grátis com o link. Valor fixo alto por cliente." },
  ];

  // ---------------------------------------------------------------- a página
  HUB_VIEWS.afiliados = async function () {
    clearInterval(timer);
    page(`<div class="af" id="af">
      ${ui.head("Negócios", t("Afiliados"), t("Recomendas um produto com o teu link, alguém compra e a marca paga-te uma parte. Sem stock, sem clientes para atender."),
        `<button type="button" class="btn" data-result>${esc(t("Registar resultado"))}</button><button type="button" class="btn primary" data-new>${esc(t("Novo programa"))}</button>`)}
      <div id="af-kpis">${ui.skeleton(4)}</div>
      <div class="af-bar"><div class="segx af-views">${VIEWS.map(([k, l]) => `<button type="button" data-view="${k}">${esc(t(l))}</button>`).join("")}</div></div>
      <div id="af-body"></div>
      <div class="af-modal" id="af-modal" hidden></div>
    </div>`);
    wire();
    await load();
    view = pref.get("v3", "vender");   // v3 (3 nov): «Como vender» abre primeiro para todos uma vez
    if (!VIEWS.some(([k]) => k === view)) view = "vender";
    paint();
    timer = setInterval(() => { if (!$("af")) return clearInterval(timer); if (!$("af-modal").hidden) return; load().then(paintData).catch(() => {}); }, 30000);
  };
  onLive(["afiliados"], () => ($("af") && $("af-modal").hidden ? load().then(paintData) : Promise.resolve()));

  async function load() {
    try { D = await api("/api/afiliados"); }
    catch (e) { D = D || null; if (!D) $("af-kpis").innerHTML = ui.error(e.message); throw e; }
  }

  function paint() {
    document.querySelectorAll("#af .af-views button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    paintData();
  }
  function paintData() {
    if (!$("af") || !D) return;
    kpis();
    const body = $("af-body");
    const html = view === "vender" ? vender() : view === "exemplos" ? exemplos() : view === "meus" ? meus() : view === "calc" ? calc() : view === "provas" ? provas() : como();
    if (body._html !== html) {
      body._html = html; body.innerHTML = html;
      if (view === "calc") calcRun();
    }
  }

  // ---------------------------------------------------------------- números de cima (só o que foi registado)
  function kpis() {
    const res = D.results, has = res.length > 0, cut = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const sum = (list, k) => list.reduce((s, r) => s + (r[k] || 0), 0);
    const now30 = res.filter((r) => r.day > cut(30)), prev30 = res.filter((r) => r.day > cut(60) && r.day <= cut(30));
    const dayOf = (r) => new Date(`${r.day}T12:00:00`);
    const s = (k) => series.byDay(res, dayOf, 30, (r) => r[k]).map((p) => p.value);
    const clicks = sum(now30, "clicks"), sales = sum(now30, "sales");
    const active = D.programs.filter((p) => p.status === "ativo").length;
    $("af-kpis").innerHTML = ui.kpis([
      ui.kpi({ label: "Comissões · 30 dias", value: has ? eur(sum(now30, "earned"), 2) : null, delta: has ? ui.delta(sum(now30, "earned"), sum(prev30, "earned")) : "",
        viz: has ? ui.spark(s("earned")) : "", sub: has ? t("Total: {v}", { v: eur(sum(res, "earned"), 2) }) : t("Registar o 1.º resultado") }),
      ui.kpi({ label: "Cliques · 30 dias", value: has ? int(clicks) : null, delta: has ? ui.delta(clicks, sum(prev30, "clicks")) : "", viz: has ? ui.cols(s("clicks").slice(-14)) : "" }),
      ui.kpi({ label: "Vendas · 30 dias", value: has ? int(sales) : null, sub: has && clicks ? t("{p}% dos cliques compram", { p: ((sales / clicks) * 100).toFixed(1).replace(".", ",") }) : "",
        viz: has && clicks ? ui.ring((sales / clicks) * 100) : "" }),
      ui.kpi({ label: "Programas ativos", value: D.programs.length ? String(active) : null, sub: D.programs.length ? t("{n} no total", { n: D.programs.length }) : t("Ainda nenhum") }),
    ]);
  }

  // ---------------------------------------------------------------- os meus programas
  function meus() {
    if (!D.programs.length) {
      return `${ui.empty("link", "Ainda não tens programas", "Começa por uma das ideias abaixo (já escolhidas para o que vocês fazem) ou junta um programa à mão.", `<button type="button" class="btn primary" data-new>${esc(t("Novo programa"))}</button>`)}
      ${ideias()}`;
    }
    const by = Object.fromEntries(STATUS.map(([k]) => [k, D.programs.filter((p) => p.status === k).length]));
    const top = [...D.programs].filter((p) => p.earned > 0).sort((a, b) => b.earned - a.earned).slice(0, 8);
    return `<div class="pn-split">
        <div class="panel pad"><div class="pn-card-h"><b>${esc(t("Onde está cada programa"))}</b></div>
          <div class="af-funnel">${STATUS.map(([k, l]) => `<div class="af-st"><span class="af-pill ${TONE[k]}">${esc(t(l))}</span><b>${by[k]}</b></div>`).join("")}</div></div>
        <div class="panel pad"><div class="pn-card-h"><b>${esc(t("O que cada um rendeu"))}</b><span>${esc(t("Total registado"))}</span></div>
          ${top.length ? ui.bars(top.map((p) => ({ label: p.name.slice(0, 10), value: p.earned, tip: eur(p.earned, 2) })), { hi: 0, fmtV: (v) => eur(v, 2) })
            : `<p class="af-none">${esc(t("Ainda sem comissões registadas. Quando a rede te mostrar cliques e vendas, carrega em «Registar resultado».")) }</p>`}</div>
      </div>
      ${ui.sec("Programas", `<span class="af-hint">${esc(t("{n} programas", { n: D.programs.length }))}</span>`)}
      <div class="af-progs">${D.programs.map(card).join("")}</div>
      ${ui.sec("Resultados registados")}
      ${D.results.length ? `<div class="panel af-res">${D.results.slice(0, 40).map((r) => `<div class="af-row">
          <time>${esc(new Date(`${r.day}T12:00:00`).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" }))}</time>
          <b>${esc(r.program)}</b><span>${int(r.clicks)} ${esc(t("cliques"))}</span><span>${int(r.sales)} ${esc(t("vendas"))}</span>
          <strong>${eur(r.earned, 2)}</strong><em>${esc(r.note || r.by)}</em>
          <button type="button" class="btn quiet sm" data-delres="${r.id}" title="${esc(t("Apagar"))}">${I.x}</button></div>`).join("")}</div>`
        : `<div class="panel pad"><p class="af-none">${esc(t("Nada registado ainda. Os números vêm do painel da rede (Awin, Impact, o da própria marca): copia-os para aqui uma vez por semana."))}</p></div>`}
      ${ideias()}`;
  }

  function card(p) {
    const epc = p.clicks ? p.earned / p.clicks : null;
    return `<div class="panel af-card">
      <div class="af-card-h"><div><b>${esc(p.name)}</b><small>${esc([p.niche, p.network].filter(Boolean).join(" · ") || t("Sem nicho"))}</small></div>
        <select class="af-status" data-status="${p.id}" aria-label="${esc(t("Estado"))}">${STATUS.map(([k, l]) => `<option value="${k}" ${k === p.status ? "selected" : ""}>${esc(t(l))}</option>`).join("")}</select></div>
      <div class="af-terms"><span>${esc(comm(p))}</span>${p.cookie_days ? `<span>${esc(t("Link vale {n} dias", { n: p.cookie_days }))}</span>` : ""}</div>
      <div class="af-nums"><div><small>${esc(t("Cliques"))}</small><b>${p.days ? int(p.clicks) : "—"}</b></div><div><small>${esc(t("Vendas"))}</small><b>${p.days ? int(p.sales) : "—"}</b></div>
        <div><small>${esc(t("Comissões"))}</small><b>${p.days ? eur(p.earned, 2) : "—"}</b></div><div><small title="${esc(t("Quanto rende cada clique"))}">${esc(t("Por clique"))}</small><b>${epc == null ? "—" : eur(epc, 2)}</b></div></div>
      ${p.notes ? `<p class="af-notes">${esc(p.notes)}</p>` : ""}
      <div class="af-card-a">
        ${p.link ? `<button type="button" class="btn sm" data-copy="${p.id}">${I.copy}${esc(t("Copiar link"))}</button><a class="btn quiet sm" href="${esc(p.link)}" target="_blank" rel="noopener">${I.out}${esc(t("Abrir"))}</a>` : `<span class="af-hint">${esc(t("Sem link ainda"))}</span>`}
        <span class="af-grow"></span>
        <button type="button" class="btn quiet sm" data-result="${p.id}">${esc(t("Registar"))}</button>
        <button type="button" class="btn quiet sm" data-edit="${p.id}">${esc(t("Editar"))}</button>
      </div></div>`;
  }

  function ideias() {
    const have = new Set((D.programs || []).map((p) => p.name.toLowerCase()));
    const list = IDEIAS.filter((i) => !have.has(i.name.toLowerCase()));
    if (!list.length) return "";
    return `${ui.sec("Ideias para começar (feitas para vocês)")}
      <div class="af-ideas">${list.map((i, n) => `<div class="panel af-idea"><div class="af-card-h"><div><b>${esc(i.name)}</b><small>${esc(i.niche)}</small></div><span class="af-pill off">${esc(comm(i))}</span></div>
        <p>${esc(t(i.why))}</p><div class="af-card-a"><button type="button" class="btn sm" data-idea="${IDEIAS.indexOf(i)}">${esc(t("Juntar como ideia"))}</button>
        <a class="btn quiet sm" href="${esc(i.link)}" target="_blank" rel="noopener">${I.out}${esc(t("Ver o programa"))}</a></div></div>`).join("")}</div>`;
  }

  // ---------------------------------------------------------------- como funciona
  function como() {
    const steps = [
      [I.you, "1. Escolhes um produto", "Uma coisa em que confias e que a tua audiência quer: uma prop firm, um alojamento, uma ferramenta."],
      [I.link, "2. Recebes um link teu", "A marca dá-te um link com o teu código (ex.: …/?ref=marco). É assim que sabe que o cliente veio de ti."],
      [I.cart, "3. Alguém compra", "A pessoa clica no teu vídeo, post ou site e compra. Se só comprar dias depois, conta na mesma enquanto o link valer (o «cookie»)."],
      [I.coin, "4. Recebes a comissão", "A marca paga-te uma parte: uma % da venda, um valor fixo, ou uma % todos os meses enquanto o cliente pagar."],
    ];
    const words = [
      ["Link de afiliado", "O teu link pessoal. Tudo o que se compra por ele conta para ti."],
      ["Cookie (validade)", "Quantos dias depois do clique a compra ainda conta para ti. 30 dias é normal, 90 é ótimo."],
      ["Conversão", "De quem clica, quantos compram. 1% a 3% é normal; com um público muito certo pode ser mais."],
      ["EPC (por clique)", "Comissões ÷ cliques. Diz quanto vale cada clique: é o número que compara programas a sério."],
      ["Rede de afiliados", "Sites que juntam muitas marcas num só painel e pagam por ti: Awin, Impact, CJ. Algumas marcas têm programa próprio."],
      ["Pagamento mínimo", "Muitos só pagam a partir de 50 € ou 100 € acumulados, por transferência ou PayPal."],
    ];
    return `<div class="af-flow">${steps.map(([ic, h, p], i) => `<div class="panel af-step"><span class="af-ic">${ic}</span><b>${esc(t(h))}</b><p>${esc(t(p))}</p></div>${i < steps.length - 1 ? `<span class="af-arrow">${I.arrow}</span>` : ""}`).join("")}</div>
      ${ui.sec("Três formas de te pagarem")}
      <div class="af-three">
        <div class="panel af-kind"><small>${esc(t("% da venda"))}</small><b>Amazon · 1–10%</b><p>${esc(t("Vendes uma coisa de 40 € a 4%: ganhas 1,60 €. Fácil de entrar, precisa de muito volume."))}</p></div>
        <div class="panel af-kind"><small>${esc(t("Valor fixo por venda"))}</small><b>Semrush · 200 $</b><p>${esc(t("Cada cliente novo vale o mesmo, seja qual for o plano. Software paga bem porque o cliente fica anos."))}</p></div>
        <div class="panel af-kind lit"><small>${esc(t("% todos os meses"))}</small><b>${esc(t("Software por assinatura"))}</b><p>${esc(t("Ganhas uma parte de cada mensalidade enquanto o cliente pagar. Com 50 clientes a 10 €/mês para ti, são 500 € por mês sem vender nada de novo."))}</p></div>
      </div>
      ${ui.sec("Em português simples")}
      <div class="panel af-words">${words.map(([w, d]) => `<div><b>${esc(t(w))}</b><span>${esc(t(d))}</span></div>`).join("")}</div>
      ${ui.sec("A verdade, sem conversa de guru")}
      <div class="af-truth">
        <div class="panel pad"><b>${esc(t("É um negócio de audiência"))}</b><p>${esc(t("Sem gente a ver o teu conteúdo não há cliques. Primeiro constróis o público (TikTok, Instagram, YouTube, um site com Google), depois o dinheiro vem."))}</p></div>
        <div class="panel pad"><b>${esc(t("Demora meses"))}</b><p>${esc(t("Os casos grandes da página Provas levaram anos. Conta com 3 a 6 meses de publicações antes das primeiras comissões a sério."))}</p></div>
        <div class="panel pad"><b>${esc(t("Diz sempre que é link de afiliado"))}</b><p>${esc(t("A lei obriga a dizer que ganhas comissão (publicidade identificada). Em trading, diz também que há risco de perder dinheiro."))}</p></div>
      </div>`;
  }

  // ---------------------------------------------------------------- exemplos · Natal (3 nov, Marco: «quero aproveitar o natal...
  // mete já algumas ideias de produtos... os que valem a pena e não, explicando tudo detalhadamente»). Comissões das páginas dos
  // programas a 3 nov 2026; as da Amazon.es variam por categoria e não têm tabela pública fiável fora do painel: ficam «a confirmar».
  const VERD = { sim: ["ok", "Vale a pena"], talvez: ["wait", "Talvez"], nao: ["bad", "Não vale"] };
  const NATAL = [
    { id: "dreame", v: "sim", name: "Robô aspirador Dreame", cat: "Casa · físico", where: "Dreame (programa próprio, Impact ou Webgains)",
      comm: "mínimo 6% (anunciado pela marca)", price: "300–900 €", per: "~18–54 € por venda (estimado)",
      line: "Prenda cara de casa: uma venda paga o que 20 air fryers pagam.",
      why: ["Preço alto × 6% ou mais = ~20 € ou mais por venda.", "No Black Friday os robôs têm descontos grandes, e o desconto é o que faz clicar.", "Mostra-se bem sem cara: fotos da marca, «antes e depois» do chão, comparação de modelos."],
      how: "Vídeo só com texto e as fotos da marca: «O robô que limpa a casa enquanto estás no trabalho: -30% no Black Friday». Link na bio.",
      warn: "Confirma a taxa para Portugal/Espanha no painel. Devoluções anulam a comissão." },
    { id: "ecoflow", v: "sim", name: "Bateria portátil EcoFlow", cat: "Gadgets · físico", where: "EcoFlow (Awin / Tradedoubler, há programa para Espanha)",
      comm: "5–8% conforme a rede", price: "300–1500 €", per: "~15–100 € por venda (estimado)",
      line: "Produto caro com público certo: campismo, autocaravanas, cortes de luz.",
      why: ["Preço muito alto: mesmo a 5% dá 15 € ou mais.", "Ângulo forte depois do apagão: «nunca mais ficas sem luz em casa».", "Nicho com menos concorrência do que os telemóveis."],
      how: "Vídeo com as fotos da marca: «Isto liga o frigorífico 10 horas sem luz». Comparação de 2 modelos por preço.",
      warn: "Algumas redes dão só 7 dias de cookie. Confirma a taxa de Espanha antes de começar." },
    { id: "fn", v: "sim", name: "Conta FundedNext como prenda", cat: "Trading · digital", where: "FundedNext (programa próprio)",
      comm: "12% da compra (15–18% nos níveis de cima)", price: "~100–500 € por conta (estimado)", per: "~12–60 € por venda",
      line: "O teu nicho: já negoceias lá e tens o painel no Hub. Produto digital, chega na hora.",
      why: ["Comissão alta num produto caro: uma venda vale mais do que 20 air fryers.", "É digital: vende-se até dia 24 à noite sem medo de prazos de entrega.", "As prop firms costumam fazer as maiores promoções do ano no Black Friday, o que ajuda quem estava indeciso.", "Tu tens prova real (o teu Painel FundedNext): isso convence mais do que qualquer anúncio."],
      how: "Vídeo curto: «A prenda que qualquer trader quer: uma conta de 100k para negociar». Mostra o teu painel, explica as regras em 30 s e põe o link na bio com o código do Black Friday.",
      warn: "Produto de risco: diz sempre que a maioria não passa o desafio e que se pode perder o dinheiro da conta. Nada de prometer lucros." },
    { id: "tv", v: "sim", name: "TradingView (assinatura)", cat: "Trading · digital", where: "Programa de parceiros TradingView",
      comm: "30% recorrente enquanto o cliente pagar (regras do programa)", price: "planos mensais ou anuais", per: "30% do plano, todos os meses ou todos os anos",
      line: "Recorrente: o cliente que trazes em dezembro paga-te o ano todo.",
      why: ["Comissão recorrente: é a que acumula, como explicado em «Como funciona».", "Todos os traders usam ou querem usar; não tens de convencer ninguém do produto.", "Costuma ter promoções grandes no Black Friday.", "Digital: sem prazos de entrega."],
      how: "Mostra o teu gráfico do ouro com os teus indicadores: «o setup que uso todos os dias». Link no fim: «está com desconto até domingo».",
      warn: "Só conta para utilizadores novos e só compras feitas na versão web. Confirma as condições na página do programa." },
    { id: "host", v: "sim", name: "Alojamento Hostinger (site para 2027)", cat: "Negócios · digital", where: "Hostinger (programa próprio)",
      comm: "até 60% da venda (anunciado)", price: "planos anuais baratos no Black Friday", per: "~20–40 € por venda (estimado)",
      line: "Junta-se ao que vocês já fazem: cada site que a equipa vende precisa de alojamento.",
      why: ["Percentagem altíssima.", "Público que já tens: as empresas do Radar e do CRM, os clientes da Ten Fold, as escolas de condução.", "O Black Friday é a altura em que os alojamentos fazem os preços mais baixos do ano.", "Não é uma prenda: é «começa 2027 com site». Menos concorrência do que os brinquedos."],
      how: "Post para pequenas empresas: «O teu negócio ainda não tem site? Em 2027 vai ter: alojamento a X € no Black Friday + nós fazemos o site». Ganhas a comissão e um cliente.",
      warn: "Confirma a percentagem real no teu painel (alguns sites falam em 40% para começar)." },
    { id: "beauty", v: "talvez", name: "Kits de perfume e beleza", cat: "Prenda clássica · físico", where: "Amazon.es",
      comm: "a confirmar (a «beleza de luxo» chega a 10% noutros países da Amazon)", price: "30–120 €", per: "~1–10 € por venda (estimado)",
      line: "Prenda nº 1 em todas as listas, mas tens de confirmar a taxa da categoria em Espanha.",
      why: ["Toda a gente compra um perfume no Natal: procura enorme.", "Se a taxa for a da beleza de luxo, é das melhores percentagens da Amazon.", "Kits de oferta já vêm prontos a embrulhar."],
      how: "Lista «5 perfumes abaixo de 50 € que parecem caros», um vídeo por perfume, link para cada um.",
      warn: "O cookie da Amazon só dura 24 horas: a pessoa tem de comprar quase logo. E muitos criadores fazem o mesmo, por isso destaca-te com um ângulo (preço, homem, adolescentes)." },
    { id: "fryer", v: "talvez", name: "Air fryer", cat: "Casa · físico", where: "Amazon.es",
      comm: "a confirmar no painel (cozinha costuma ser baixa, ~3–5%)", price: "60–150 €", per: "~2–6 € por venda (estimado)",
      line: "Vende-se sozinha e no Black Friday está sempre em promoção, mas ganhas pouco por cada uma.",
      why: ["Produto que as pessoas já procuram: converte bem.", "Fácil de mostrar em vídeo (receitas).", "Bom para aprender: muitas vendas, pouco dinheiro, mas vês o sistema a funcionar."],
      how: "Vídeo «3 receitas de Natal na air fryer em 10 minutos» com o modelo usado no link.",
      warn: "Precisa de volume: 100 vendas para fazer 300–500 €. Sozinha não faz um Natal." },
    { id: "lego", v: "talvez", name: "LEGO para adultos e crianças", cat: "Brinquedos · físico", where: "Amazon.es",
      comm: "a confirmar (brinquedos costumam ser ~3%)", price: "40–200 €", per: "~1–6 € por venda (estimado)",
      line: "Campeão de vendas no Natal, mas é onde há mais concorrência de todos.",
      why: ["Preço médio alto para um brinquedo.", "Adultos compram para si (Star Wars, Technic): público fiel.", "Os descontos da Amazon no Black Friday são grandes em LEGO."],
      how: "Comparação «o LEGO certo para cada idade», 30 s, com o preço de hoje.",
      warn: "Os preços mudam todos os dias: nunca escrevas um preço fixo no post. A partir de ~15 dez, só stock com entrega garantida." },
    { id: "phone", v: "nao", name: "Telemóveis, auscultadores, smartwatches", cat: "Eletrónica · físico", where: "Amazon.es / lojas",
      comm: "baixa (eletrónica costuma ser ≤ 4%)", price: "100–1000 €", per: "pouco para o esforço",
      line: "Toda a gente quer, por isso toda a gente vende: grandes sites já ganham a pesquisa.",
      why: ["Concorrência máxima: lojas, comparadores e youtubers grandes já ocupam tudo.", "Percentagem baixa: num auricular de 150 € ganhas poucos euros.", "As pessoas comparam preços até ao último minuto e compram noutro sítio (e o cookie de 24 h perde-se)."],
      how: "Só valeria com uma audiência tua que confie em ti num nicho (por exemplo, «o melhor relógio para treinar»).",
      warn: "Não comeces por aqui." },
    { id: "gift", v: "nao", name: "Cartões-oferta da Amazon", cat: "Vale de compras", where: "Amazon",
      comm: "0%: a Amazon não paga nada em cartões-oferta", price: "qualquer", per: "0 €",
      line: "Parece a prenda perfeita para recomendar, mas a comissão é zero.",
      why: ["Nas tabelas da Amazon, os cartões-oferta estão na linha de 0%.", "É o exemplo clássico de produto popular que não te paga."],
      how: "—", warn: "Cuidado também com as consolas: em algumas tabelas da Amazon também não pagam nada." },
    { id: "ali", v: "nao", name: "Gadgets baratos do AliExpress", cat: "Gadgets · físico", where: "AliExpress Portals",
      comm: "anunciado até 9%, na prática ~3%", price: "2–20 €", per: "cêntimos por venda",
      line: "Barato e viral, mas chega depois do Natal e quase não paga.",
      why: ["Produtos de poucos euros: 3% de 10 € são 30 cêntimos.", "Entregas de 1 a 4 semanas: a partir de meados de novembro já não chega a tempo do Natal.", "Clientes zangados com atrasos não voltam a clicar nos teus links."],
      how: "Só fora do Natal, e só se for um gadget mesmo viral.", warn: "Para dezembro, esquece." },
  ];

  // ---------------------------------------------------------------- como vender (3 nov, Marco: primeiro «tenho de mostrar a cara?»,
  // depois «pouco texto» e por fim «tira os gráficos: quero produtos, ~20 € por cada um, como faço com produto e fornecedor. Vai
  // funcionar?»). Produtos físicos de marcas com programa de afiliados; taxas das páginas dos programas a 3 nov 2026.
  function vender() {
    const sv = (d) => `<svg class="i" viewBox="0 0 24 24">${d}</svg>`;
    const IC = {
      box: sv('<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>'),
      truck: sv('<path d="M2 6h11v10H2zM13 9h4.5L21 12.5V16h-8"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>'),
      hand: sv('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-.5V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 5 16.5L3.5 13a1.5 1.5 0 0 1 2.6-1.5L8 14"/>'),
      img: sv('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
      ai: sv('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),
      vs: sv('<path d="M7 4v16M17 4v16M3 8h8M13 16h8"/>'),
      play: sv('<rect x="5" y="2.5" width="14" height="19" rx="3"/><path d="m10.5 9 4 3-4 3z"/>'),
      link: I.link, cart: I.cart, coin: I.coin, user: I.you,
    };
    const tile = (ic, h, p, cls = "") => `<div class="panel af-tile ${cls}"><span class="af-ic">${ic}</span><b>${esc(t(h))}</b>${p ? `<span>${esc(t(p))}</span>` : ""}</div>`;
    const flow = (items) => `<div class="af-flow5">${items.map((x, i) => tile(...x) + (i < items.length - 1 ? `<span class="af-arrow">${I.arrow}</span>` : "")).join("")}</div>`;
    const prod = (v, name, price, pct, you, note) => `<div class="panel af-tile af-money ${v === "sim" ? "af-best" : ""}">
      <span class="af-pill ${VERD[v][0]}">${esc(t(VERD[v][1]))}</span><b>${esc(name)}</b>
      <div class="af-eq"><span>${esc(price)}</span><em>×</em><span>${esc(pct)}</span><em>=</em><strong>${esc(you)}</strong></div>
      <span>${esc(t(note))}</span></div>`;
    // Black Friday e Natal: preço médio com 25% de desconto × 6% (estimativas, ditas na página)
    const bfPer = (price, off, pct) => price * (1 - off) * pct;
    const BF_AVG = (bfPer(500, 0.25, 0.06) + bfPer(800, 0.25, 0.06)) / 2;
    const BF_SCEN = [["Fraco", 20000], ["Normal", 60000], ["Bom", 150000]];
    const bfProd = (name, price, off, pct) => `<div class="panel af-tile af-money"><b>${esc(name)}</b>
      <div class="af-eq"><span class="af-was">${eur(price)}</span><span>${eur(price * (1 - off))}</span><em>×</em><span>${Math.round(pct * 100)}%</span><em>=</em><strong>${eur(bfPer(price, off, pct), 2)}</strong></div>
      <span>${esc(t("Preço médio com -{p}% no Black Friday", { p: Math.round(off * 100) }))}</span></div>`;
    const steps = [["50 000", "pessoas veem", "os teus vídeos num mês"], ["2 500", "clicam", "5% de quem vê"], ["50", "compram", "2% de quem clica"], ["1 000 €", "para ti", "50 × 20 €"]];
    return `<div class="af-xmas panel af-hero"><div><small>${esc(t("Numa frase"))}</small>
        <b>${esc(t("Tu mostras o produto. A marca vende, entrega e paga-te."))}</b>
        <p>${esc(t("Sem fornecedor, sem stock, sem falar com clientes."))}</p></div></div>

      ${ui.sec("A tua loja vs. afiliado")}
      <div class="af-vs">
        <div class="panel af-tile"><span class="af-ic">${IC.truck}</span><b>${esc(t("A tua loja (fornecedor)"))}</b>
          <ul><li>${esc(t("Compras ao fornecedor"))}</li><li>${esc(t("Guardas e envias"))}</li><li>${esc(t("Atendes e trocas"))}</li><li>${esc(t("Ficas com a margem"))}</li></ul></div>
        <span class="af-vs-x">vs</span>
        <div class="panel af-tile af-best"><span class="af-ic">${IC.link}</span><b>${esc(t("Afiliado"))}</b>
          <ul><li>${esc(t("A marca tem o stock"))}</li><li>${esc(t("A marca envia"))}</li><li>${esc(t("A marca atende"))}</li><li>${esc(t("Tu ficas com a %"))}</li></ul></div>
      </div>

      ${ui.sec("Como entra o dinheiro")}
      ${flow([[IC.play, "Vídeo do produto", "TikTok · Reels"], [IC.link, "Link na bio", "O teu código"], [IC.cart, "Compra", "No site da marca"], [IC.box, "A marca envia", "Tu não tocas"], [IC.coin, "% para ti", "Paga a marca"]])}

      ${ui.sec("Produtos que dão ~20 € ou mais por venda", `<span class="af-hint">${esc(t("estimado · preço × comissão"))}</span>`)}
      <div class="af-tiles4">
        ${prod("sim", "Robô aspirador Dreame", "300–900 €", "≥ 6%", "18–54 €", "Prenda de casa cara. Programa da marca.")}
        ${prod("sim", "Bateria portátil EcoFlow", "300–1500 €", "5–8%", "15–100 €", "Campismo, cortes de luz. Tem programa em Espanha.")}
        ${prod("talvez", "Colchão Emma", "300–800 €", "2–5%", "6–40 €", "Só paga depois de 100 noites.")}
        ${prod("nao", "Coisas de 20 €", "20 €", "3%", "0,60 €", "Precisas de 33 vendas para 20 €.")}
      </div>
      <p class="af-hint">${esc(t("Também há marcas que pagam por pessoa inscrita, sem compra (ex.: Semrush, 10 $ por cada teste grátis)."))}</p>

      ${ui.sec("Contas do Black Friday e do Natal", `<span class="af-hint">${esc(t("27 nov → 20 dez · estimado"))}</span>`)}
      <div class="af-tiles3">
        ${bfProd("Robô Dreame", 500, 0.25, 0.06)}
        ${bfProd("Bateria EcoFlow", 800, 0.25, 0.06)}
        <div class="panel af-tile"><span class="af-ic">${IC.coin}</span><b>${esc(t("Média por venda"))}</b><div class="af-eq"><strong>${eur(BF_AVG, 2)}</strong></div><span>${esc(t("Metade de cada produto"))}</span></div>
      </div>
      <div class="af-tiles3 af-steps">${BF_SCEN.map(([lab, views], i) => { const sales = Math.round(views * 0.05 * 0.02); return `<div class="panel af-tile ${i === 1 ? "af-best" : ""} ${i === 2 ? "af-lit" : ""}">
        <span class="af-pill ${["off", "ok", "ai"][i]}">${esc(t(lab))}</span><i>${eur(sales * BF_AVG)}</i>
        <span>${int(views)} ${esc(t("views"))} → ${int(views * 0.05)} ${esc(t("cliques"))} → <b class="af-inl">${sales} ${esc(t("vendas"))}</b></span></div>`; }).join("")}</div>
      <p class="af-hint">${esc(t("Contas: desconto de 25% no preço, 6% de comissão, 5% de quem vê clica, 2% de quem clica compra. A comissão costuma ser paga depois do prazo de devolução: o dinheiro do Natal chega em janeiro ou fevereiro."))}</p>

      ${ui.sec("Mostrar o produto sem cara e sem falar")}
      <div class="af-tiles4">
        ${tile(IC.img, "Fotos da marca + texto", "A marca dá-te as imagens", "af-best")}
        ${tile(IC.vs, "A vs B", "«Qual comprar?» em texto")}
        ${tile(IC.hand, "Só as mãos", "Se tiveres o produto")}
        ${tile(IC.ai, "Vídeo com IA", "Higgsfield, a partir da foto")}
      </div>
      <p class="af-hint">${esc(t("Não precisas de comprar o produto: o painel de afiliado da marca tem fotos e vídeos para usares."))}</p>

      ${ui.sec("Vai funcionar? As contas para 1 000 € por mês")}
      <div class="af-funnel4">${steps.map(([n, h, p], i) => `<div class="panel af-tile ${i === steps.length - 1 ? "af-lit" : ""}"><i>${esc(n)}</i><b>${esc(t(h))}</b><span>${esc(t(p))}</span></div>${i < steps.length - 1 ? `<span class="af-arrow">${I.arrow}</span>` : ""}`).join("")}</div>
      <div class="af-verdict"><div class="panel af-tile af-best"><b>${esc(t("Sim, se houver visualizações"))}</b><span>${esc(t("50 mil por mês = 1 vídeo viral ou 30 vídeos normais."))}</span></div>
        <div class="panel af-tile"><b>${esc(t("Não, sem visualizações"))}</b><span>${esc(t("0 views = 0 €. O produto não se vende sozinho."))}</span></div></div>

      ${ui.sec("Começar")}
      <div class="af-tiles4 af-steps">
        <div class="panel af-tile"><i>1</i><b>${esc(t("Inscreve-te"))}</b><span>Dreame · EcoFlow</span></div>
        <div class="panel af-tile"><i>2</i><b>${esc(t("Escolhe 1 produto"))}</b><span>${esc(t("O que paga mais"))}</span></div>
        <div class="panel af-tile"><i>3</i><b>${esc(t("1 vídeo por dia"))}</b><span>${esc(t("Fotos + texto"))}</span></div>
        <div class="panel af-tile af-best"><i>4</i><b>${esc(t("Regista aqui"))}</b><span>${esc(t("Os meus programas"))}</span></div>
      </div>`;
  }

  function natalDates() {
    const now = new Date(), y = now.getMonth() === 0 && now.getDate() <= 6 ? now.getFullYear() - 1 : now.getFullYear();
    const nov1 = new Date(y, 10, 1), thu = 1 + ((4 - nov1.getDay() + 7) % 7) + 21;   // 4.ª quinta-feira de novembro (Thanksgiving)
    const bf = new Date(y, 10, thu + 1), cm = new Date(y, 10, thu + 4), xmas = new Date(y, 11, 25);
    const days = (d) => Math.ceil((new Date(d.toDateString()) - new Date(now.toDateString())) / 864e5);
    const dm = (d) => `${d.getDate()} ${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][d.getMonth()]}`;
    return { y, bf, cm, xmas, days, dm };
  }

  function exemplos() {
    const N = natalDates(), d = (x) => N.days(x);
    const fase = (from, to) => { const a = d(from), b = d(to); return b < 0 ? "af-done" : a <= 0 ? "af-now" : ""; };
    const D0 = new Date(N.y, 10, 1), D15 = new Date(N.y, 10, 15), D16 = new Date(N.y, 10, 16), D1 = new Date(N.y, 11, 1), D14 = new Date(N.y, 11, 14),
      D15d = new Date(N.y, 11, 15), D24 = new Date(N.y, 11, 24), D26 = new Date(N.y, 11, 26), J6 = new Date(N.y + 1, 0, 6), bfEve = new Date(N.bf.getTime() - 864e5);
    const plan = [
      [D0, D15, `1 – 15 nov`, "Preparar", "Escolhe 2 ou 3 produtos desta lista (os verdes). Inscreve-te nos programas (FundedNext, TradingView, Hostinger e Amazon.es). Cria ou arruma uma conta de TikTok/Instagram só para isto e faz os primeiros 5 vídeos."],
      [D16, bfEve, `16 nov – ${N.dm(bfEve)}`, "Aquecer", "Publica todos os dias: «guia de prendas para traders», «o que comprar no Black Friday». Ainda vendes pouco, mas o algoritmo começa a mostrar-te. Junta os links em «Os meus programas»."],
      [N.bf, N.cm, `${N.dm(N.bf)} – ${N.dm(N.cm)}`, "Black Friday e Cyber Monday", "O pico do ano. 2 a 3 publicações por dia, sempre com o desconto e a data em que acaba («só até segunda»). É aqui que se faz a maior parte do dinheiro."],
      [D1, D14, "1 – 14 dez", "Prendas a tempo", "«Prendas que ainda chegam antes do Natal». Físicos só com entrega rápida; empurra os digitais."],
      [D15d, D24, "15 – 24 dez", "Última hora", "Só digitais (contas de trading, TradingView, alojamento) e entregas Prime. «Esqueceste-te da prenda? Esta chega por email.»"],
      [D26, J6, "26 dez – 6 jan", "Ano novo", "Saldos e objetivos de 2027: «este ano vou aprender trading», «este ano o negócio tem site». Ótimo para FundedNext, TradingView e Hostinger."],
    ];
    const list = NATAL.filter((p) => exF === "todos" || p.v === exF);
    const count = (v) => NATAL.filter((p) => p.v === v).length;
    const have = new Set((D.programs || []).map((p) => p.name.toLowerCase()));
    return `<div class="af-xmas panel">
        <div><small>${esc(t("Natal {y}", { y: N.y }))}</small><b>${esc(t("Os afiliados ganham o ano em 4 semanas"))}</b><p>${esc(t("Entre o Black Friday e o Natal as pessoas compram mais do que no resto do ano. Quem já tem os links e os vídeos prontos antes do Black Friday apanha esse dinheiro; quem começa em dezembro chega tarde."))}</p></div>
        <div class="af-count"><div><b>${Math.max(0, d(N.bf))}</b><span>${esc(t("dias para o Black Friday"))}<br>${esc(N.dm(N.bf))}</span></div><div><b>${Math.max(0, d(N.xmas))}</b><span>${esc(t("dias para o Natal"))}<br>${esc(N.dm(N.xmas))}</span></div></div>
      </div>
      ${ui.sec("O plano, semana a semana")}
      <div class="af-plan">${plan.map(([a, b, when, h, p]) => { const f = fase(a, b); return `<div class="panel af-ph ${f}"><div class="af-ph-h"><span>${esc(when)}</span>${f === "af-now" ? `<i class="af-pill ok">${esc(t("Agora"))}</i>` : f === "af-done" ? `<i class="af-pill off">${esc(t("Passou"))}</i>` : ""}</div><b>${esc(t(h))}</b><p>${esc(t(p))}</p></div>`; }).join("")}</div>
      ${ui.sec("Produtos: os que valem a pena e os que não", `<span class="af-hint">${esc(t("Ganhos por venda estimados"))}</span>`)}
      <div class="segx af-exf">${[["todos", `Todos · ${NATAL.length}`], ["sim", `Vale a pena · ${count("sim")}`], ["talvez", `Talvez · ${count("talvez")}`], ["nao", `Não vale · ${count("nao")}`]]
        .map(([k, l]) => `<button type="button" data-exf="${k}" class="${k === exF ? "on" : ""}">${esc(t(l))}</button>`).join("")}</div>
      <div class="af-prods">${list.map((p) => { const open = exOpen === p.id, [tone, lab] = VERD[p.v]; return `<div class="panel af-prod ${p.v} ${open ? "open" : ""}">
        <div class="af-card-h"><div><b>${esc(p.name)}</b><small>${esc(p.cat)}</small></div><span class="af-pill ${tone}">${esc(t(lab))}</span></div>
        <p class="af-line">${esc(t(p.line))}</p>
        <dl class="af-facts"><div><dt>${esc(t("Onde"))}</dt><dd>${esc(p.where)}</dd></div><div><dt>${esc(t("Comissão"))}</dt><dd>${esc(t(p.comm))}</dd></div>
          <div><dt>${esc(t("Preço"))}</dt><dd>${esc(t(p.price))}</dd></div><div><dt>${esc(t("Ganhas por venda"))}</dt><dd><strong>${esc(t(p.per))}</strong></dd></div></dl>
        ${open ? `<div class="af-more"><h4>${esc(t(p.v === "nao" ? "Porque não vale" : "Porque vale"))}</h4><ul>${p.why.map((w) => `<li>${esc(t(w))}</li>`).join("")}</ul>
          ${p.how !== "—" ? `<h4>${esc(t("Como vender (exemplo)"))}</h4><p>${esc(t(p.how))}</p>` : ""}<h4>${esc(t("Atenção"))}</h4><p>${esc(t(p.warn))}</p></div>` : ""}
        <div class="af-card-a"><button type="button" class="btn sm" data-exopen="${p.id}">${esc(t(open ? "Fechar" : "Ver a explicação toda"))}</button><span class="af-grow"></span>
          ${p.v !== "nao" ? (have.has(p.name.toLowerCase()) ? `<span class="af-hint">${esc(t("Já está nos teus programas"))}</span>` : `<button type="button" class="btn quiet sm" data-natal="${p.id}">${esc(t("Juntar aos meus programas"))}</button>`) : ""}</div>
      </div>`; }).join("")}</div>
      ${ui.sec("A regra para escolher qualquer produto")}
      <div class="panel af-rules">
        <div><b>1</b><span>${esc(t("Paga pelo menos 5 € por venda, ou paga todos os meses."))}</span></div>
        <div><b>2</b><span>${esc(t("Chega a tempo: em dezembro, digital ou entrega rápida."))}</span></div>
        <div><b>3</b><span>${esc(t("Tens algo a dizer sobre ele (usas, percebes do assunto)."))}</span></div>
        <div><b>4</b><span>${esc(t("Não é o que toda a gente já está a vender."))}</span></div>
      </div>
      <p class="af-hint">${esc(t("Comissões vistas nas páginas dos programas a 3 nov 2026; as da Amazon.es confirmam-se no painel depois de entrares. Valores por venda são estimativas para comparar, não promessas."))}</p>`;
  }

  // ---------------------------------------------------------------- calculadora
  function calc() {
    const ex = EXEMPLOS.find((e) => e.id === pref.get("ex", "prop")) || EXEMPLOS[0];
    const f = (id, label, v, step, hint) => `<label class="field"><span>${esc(t(label))}</span><input type="number" min="0" step="${step}" id="af-${id}" value="${v}">${hint ? `<em>${esc(t(hint))}</em>` : ""}</label>`;
    return `<div class="af-exs segx">${EXEMPLOS.map((e) => `<button type="button" data-ex="${e.id}" class="${e.id === ex.id ? "on" : ""}">${esc(e.name)}</button>`).join("")}</div>
      <div class="pn-split af-calc">
        <div class="panel pad"><div class="pn-card-h"><b>${esc(t("As tuas contas"))}</b></div><p class="af-exnote">${esc(t(ex.note))}</p>
          <div class="af-form">
            ${f("visits", "Pessoas que veem por mês", ex.visits, 100, "Visualizações do vídeo, visitas ao site")}
            ${f("ctr", "% que clica no link", ex.ctr, 0.5, "Normal: 2% a 10%")}
            ${f("conv", "% de quem clica que compra", ex.conv, 0.5, "Normal: 1% a 5%")}
            <label class="field"><span>${esc(t("Como pagam"))}</span><select id="af-kind">${KINDS.map(([k, l]) => `<option value="${k}" ${k === ex.kind ? "selected" : ""}>${esc(t(l))}</option>`).join("")}</select></label>
            ${f("price", "Preço do produto (€)", ex.price, 1, "")}
            ${f("c", "Comissão (% ou €)", ex.c, 0.5, "")}
          </div></div>
        <div class="panel pad"><div class="pn-card-h"><b>${esc(t("O que dá"))}</b><span>${esc(t("Estimativa, não promessa"))}</span></div><div id="af-out"></div></div>
      </div>`;
  }
  function calcRun() {
    const v = (id) => Math.max(0, Number(($(`af-${id}`) || {}).value) || 0);
    const kind = ($("af-kind") || {}).value || "pct";
    const pr = $("af-price"); if (pr) pr.closest(".field").style.display = kind === "fixed" ? "none" : "";
    const clicks = v("visits") * v("ctr") / 100, sales = clicks * v("conv") / 100;
    const per = kind === "fixed" ? v("c") : v("price") * v("c") / 100;
    const month = sales * per;
    // recorrente: cada mês entram clientes novos e os antigos continuam (sem contar quem cancela): ao fim de 12 meses
    const year = kind === "recurring" ? per * sales * 78 : month * 12;
    const out = $("af-out"); if (!out) return;
    out.innerHTML = `<div class="af-big"><small>${esc(t("Por mês"))}</small><b>${eur(month)}</b></div>
      <div class="af-math">
        <div><span>${esc(t("Cliques no link"))}</span><b>${int(clicks)}</b></div>
        <div><span>${esc(t("Vendas"))}</span><b>${sales.toLocaleString("pt-PT", { maximumFractionDigits: 1 })}</b></div>
        <div><span>${esc(t("Ganhas por venda"))}</span><b>${eur(per, 2)}</b></div>
        <div><span>${esc(kind === "recurring" ? t("Ao fim de 1 ano (somando os meses)") : t("Por ano"))}</span><b>${eur(year)}</b></div>
        <div><span>${esc(t("Por clique (EPC)"))}</span><b>${clicks ? eur(month / clicks, 2) : "—"}</b></div>
      </div>
      <p class="af-none">${esc(kind === "recurring" ? t("Recorrente: os clientes de cada mês continuam a pagar-te nos meses seguintes, por isso o ano soma muito mais do que 12 × o 1.º mês (sem contar quem cancela).") : t("Para dobrar: ou dobras quem vê, ou escolhes um produto que paga o dobro por venda. A segunda costuma ser mais rápida."))}</p>`;
  }

  // ---------------------------------------------------------------- provas
  function provas() {
    return `<p class="af-lead">${esc(t("Casos públicos, com a fonte ao lado. Clica na fonte para confirmares tu."))}</p>
      <div class="af-proofs">${PROVAS.map((p) => `<div class="panel af-proof"><div class="af-proof-n">${esc(p.big)}</div><b>${esc(p.who)}</b><p>${esc(t(p.what))}</p>
        <div class="af-lesson">${esc(t(p.lesson))}</div><a class="af-src" href="${esc(p.url)}" target="_blank" rel="noopener">${I.out}${esc(p.src)}</a></div>`).join("")}</div>
      <p class="af-hint">${esc(t("Valores em dólares como as fontes os dão. As taxas mudam: confirma sempre na página do programa antes de te inscreveres."))}</p>`;
  }

  // ---------------------------------------------------------------- janelas
  function modal(title, inner, onsubmit) {
    const box = $("af-modal");
    box.innerHTML = `<form class="af-mod-in" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="af-mod-h"><h3>${esc(title)}</h3><button type="button" class="btn quiet sm" data-close aria-label="${esc(t("Fechar"))}">${I.x}</button></div>
      ${inner}<p class="af-err" id="af-err" hidden></p><div class="af-mod-a">${onsubmit.extra || ""}<span class="af-grow"></span><button type="button" class="btn quiet" data-close>${esc(t("Cancelar"))}</button><button type="submit" class="btn primary">${esc(t("Guardar"))}</button></div></form>`;
    box.hidden = false;
    const form = box.querySelector("form");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      try { await onsubmit(data); close(); await load(); paintData(); }
      catch (err) { const el = $("af-err"); el.hidden = false; el.textContent = err.message || t("Não deu para guardar."); }
    };
    const first = form.querySelector("input, select"); if (first) first.focus();
  }
  function close() { const b = $("af-modal"); if (b) { b.hidden = true; b.innerHTML = ""; } }

  function editProgram(p) {
    const x = p || { name: "", niche: "", network: "", link: "", kind: "pct", commission: "", cookie_days: "", status: "ideia", notes: "" };
    const f = (n, l, v, type = "text", attrs = "") => `<label class="field"><span>${esc(t(l))}</span><input name="${n}" type="${type}" value="${esc(v ?? "")}" ${attrs}></label>`;
    const del = p ? `<button type="button" class="btn quiet" data-delprog="${p.id}">${esc(t("Apagar programa"))}</button>` : "";
    const save = async (d) => {
      const body = { name: d.name, niche: d.niche, network: d.network, link: d.link, kind: d.kind, status: d.status, notes: d.notes,
        commission: Number(String(d.commission).replace(",", ".")) || 0, cookie_days: Number(d.cookie_days) || 0 };
      if (p) await api(`/api/afiliados/programas/${p.id}`, { method: "PATCH", body });
      else await api("/api/afiliados/programas", { method: "POST", body });
      flash(t("Programa guardado"));
    };
    save.extra = del;
    modal(p ? t("Editar programa") : t("Novo programa"), `<div class="af-form">
      ${f("name", "Nome", x.name, "text", "required maxlength=120 placeholder=\"FundedNext\"")}
      ${f("niche", "Nicho", x.niche, "text", "maxlength=80 placeholder=\"Trading, Sites, IA…\"")}
      ${f("network", "Rede", x.network, "text", "maxlength=80 placeholder=\"Programa próprio, Awin, Impact…\"")}
      <label class="field"><span>${esc(t("Estado"))}</span><select name="status">${STATUS.map(([k, l]) => `<option value="${k}" ${k === x.status ? "selected" : ""}>${esc(t(l))}</option>`).join("")}</select></label>
      <label class="field"><span>${esc(t("Como pagam"))}</span><select name="kind">${KINDS.map(([k, l]) => `<option value="${k}" ${k === x.kind ? "selected" : ""}>${esc(t(l))}</option>`).join("")}</select></label>
      ${f("commission", "Comissão (% ou €)", x.commission, "text", "inputmode=decimal")}
      ${f("cookie_days", "Link vale (dias)", x.cookie_days, "number", "min=0")}
      <label class="field af-wide"><span>${esc(t("O teu link de afiliado"))}</span><input name="link" type="url" value="${esc(x.link)}" placeholder="https://…?ref=…"></label>
      <label class="field af-wide"><span>${esc(t("Notas"))}</span><textarea name="notes" maxlength="4000">${esc(x.notes)}</textarea></label></div>`, save);
  }

  function addResult(pid) {
    if (!D.programs.length) return editProgram();
    const today = new Date(); today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    modal(t("Registar resultado"), `<p class="af-none">${esc(t("Copia os números do painel da rede (de um dia ou da semana toda)."))}</p><div class="af-form">
      <label class="field af-wide"><span>${esc(t("Programa"))}</span><select name="program_id">${D.programs.map((p) => `<option value="${p.id}" ${String(p.id) === String(pid) ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
      <label class="field"><span>${esc(t("Dia"))}</span><input name="day" type="date" value="${today.toISOString().slice(0, 10)}"></label>
      <label class="field"><span>${esc(t("Cliques"))}</span><input name="clicks" type="number" min="0" value="0"></label>
      <label class="field"><span>${esc(t("Vendas"))}</span><input name="sales" type="number" min="0" value="0"></label>
      <label class="field"><span>${esc(t("Comissão ganha (€)"))}</span><input name="earned" type="text" inputmode="decimal" value="0"></label>
      <label class="field af-wide"><span>${esc(t("Nota"))}</span><input name="note" maxlength="300" placeholder="${esc(t("Ex.: vídeo do TikTok de dia 2"))}"></label></div>`,
    async (d) => {
      await api("/api/afiliados/resultados", { method: "POST", body: { program_id: Number(d.program_id), day: d.day, clicks: Number(d.clicks) || 0,
        sales: Number(d.sales) || 0, earned: Number(String(d.earned).replace(",", ".")) || 0, note: d.note } });
      flash(t("Resultado registado"));
    });
  }

  // ---------------------------------------------------------------- cliques
  function wire() {
    const root = $("af");
    root.onclick = async (e) => {
      const g = (s) => e.target.closest(s);
      let b;
      if ((b = g("[data-close]")) || e.target === $("af-modal")) return close();
      if ((b = g("[data-view]"))) { view = b.dataset.view; pref.set("v3", view); return paint(); }
      if ((b = g("[data-ex]"))) { pref.set("ex", b.dataset.ex); $("af-body")._html = ""; return paintData(); }
      if ((b = g("[data-exf]"))) { exF = b.dataset.exf; return paintData(); }
      if ((b = g("[data-exopen]"))) { exOpen = exOpen === b.dataset.exopen ? "" : b.dataset.exopen; return paintData(); }
      if ((b = g("[data-natal]"))) {
        const p = NATAL.find((x) => x.id === b.dataset.natal);
        const terms = { fn: ["pct", 12, 90, "Trading"], tv: ["recurring", 30, 90, "Trading"], host: ["pct", 60, 30, "Sites"] }[p.id] || ["pct", 0, 1, "Natal"];
        await api("/api/afiliados/programas", { method: "POST", body: { name: p.name, niche: terms[3], network: p.where, kind: terms[0], commission: terms[1],
          cookie_days: terms[2], status: "ideia", link: "", notes: `${t(p.line)}\n${t("Como vender")}: ${t(p.how)}` } });
        flash(t("{n} juntado aos teus programas", { n: p.name })); await load(); return paintData();
      }
      if (g("[data-new]")) return editProgram();
      if ((b = g("[data-result]"))) return addResult(b.dataset.result);
      if ((b = g("[data-edit]"))) return editProgram(D.programs.find((p) => String(p.id) === b.dataset.edit));
      if ((b = g("[data-copy]"))) {
        const p = D.programs.find((x) => String(x.id) === b.dataset.copy);
        try { await navigator.clipboard.writeText(p.link); flash(t("Link copiado")); } catch { flash(t("Não deu para copiar")); }
        return;
      }
      if ((b = g("[data-idea]"))) {
        const i = IDEIAS[Number(b.dataset.idea)];
        await api("/api/afiliados/programas", { method: "POST", body: { name: i.name, niche: i.niche, network: i.network, kind: i.kind, commission: i.commission,
          cookie_days: i.cookie_days, status: "ideia", link: "", notes: `${t(i.why)}\n${t("Inscrição")}: ${i.link}` } });
        flash(t("{n} juntado às ideias", { n: i.name })); view = "meus"; pref.set("v3", view); await load(); return paint();
      }
      if ((b = g("[data-delprog]"))) {
        if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = t("Carrega outra vez para apagar"); return; }
        await api(`/api/afiliados/programas/${b.dataset.delprog}`, { method: "DELETE" });
        close(); flash(t("Programa apagado")); await load(); return paintData();
      }
      if ((b = g("[data-delres]"))) {
        if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.classList.add("sure"); b.title = t("Carrega outra vez para apagar"); return; }
        await api(`/api/afiliados/resultados/${b.dataset.delres}`, { method: "DELETE" });
        await load(); return paintData();
      }
    };
    root.onchange = async (e) => {
      const s = e.target.closest("[data-status]");
      if (s) { await api(`/api/afiliados/programas/${s.dataset.status}`, { method: "PATCH", body: { status: s.value } }); await load(); return paintData(); }
      if (e.target.closest(".af-calc")) calcRun();
    };
    root.oninput = (e) => { if (e.target.closest(".af-calc")) calcRun(); };
    document.addEventListener("keydown", function esc_(e) { if (!$("af")) return document.removeEventListener("keydown", esc_); if (e.key === "Escape" && !$("af-modal").hidden) close(); });
  }
})();
