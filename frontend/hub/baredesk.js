// BareDesk: a tab of Trabalho (Empresas, Projetos, Código, Entregas, BareDesk, Kit do Claude). One page for the whole
// project: the shop's numbers first, then the sections of the company (Sites, Tema, Skills, Plugins, Vídeos, Fotos,
// Documentos) as a bar on top. Shopify (sales) and Meta Ads come from /api/store/summary, which the Hub keeps for 45 s.
// A figure is live or it says it is missing: never a made-up zero. With neither connected the shop is one panel that says
// what connecting gives and exactly which key is missing. The sections are the company's own
// (library/companies/baredesk/company.json). Styles: amg.css (the shop's figures, shared with Mercados) and baredesk.css.

let shopPeriod = "today";
let shopSeen = null;   // the newest order already seen, so a new sale rings once
let shopReload = null; // reloads the shop on screen; the minute timer below calls it
const SHOP_PERIODS = [["today", "Hoje"], ["week", "7 dias"], ["month", "30 dias"]];

const shMoney = (n, currency) => (n == null ? "—" : fmt.money(n, currency || "EUR"));
const shInt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("pt-PT"));
const shRoas = (n) => n.toFixed(2).replace(".", ",") + "×";
const shPct = (n) => n.toFixed(n < 10 ? 1 : 0).replace(".", ",") + "%";

// The two sources of the shop: what each gives once connected, and how it stands on this PC.
const SH_SOURCES = {
  shopify: ["Shopify", "bag", "As vendas, a faturação e os produtos que mais vendem."],
  meta: ["Meta Ads", "trend", "O gasto em anúncios, os cliques, o caminho até à compra e cada campanha."],
};
function shLink(key, block) {
  const [name, ic, gives] = SH_SOURCES[key];
  const [tone, state] = block.source === "live" ? ["ok", "Ligado"] : block.source === "error" ? ["bad", "Não respondeu"] : ["wait", "Por ligar"];
  const fix = block.source === "error" ? `<span class="bd-err">${esc(block.error || "")}</span>`
    : block.source === "live" ? "" : `<small>${t("Falta no backend/.env")}</small><code>${esc(block.missing || "")}</code>`;
  return `<div class="bd-link ${tone}"><span class="bd-link-ic">${icon(ic)}</span>
    <div class="bd-link-t"><b>${name}</b><span>${t(gives)}</span></div>
    <div class="bd-link-k">${fix}</div><span class="st ${tone}"><i></i>${t(state)}</span></div>`;
}

// Neither Shopify nor Meta connected: one panel instead of six empty figures and two warnings.
function shOffline(s) {
  const keys = s.shopify.source === "not_connected" || s.meta.source === "not_connected";
  return `<section class="panel bd-connect">
    <div class="bd-connect-head"><span class="bd-connect-ic">${icon("bag")}</span>
      <div><h2>${t("A loja ainda não está ligada a este Hub")}</h2>
        <p>${t("Ligada, esta página mostra a faturação e as vendas da BareDesk, o que mais vende e o que os anúncios da Meta trazem, atualizado a cada minuto. Cada venda nova dá um aviso no Hub.")}</p></div></div>
    <div class="bd-connect-list">${shLink("shopify", s.shopify)}${shLink("meta", s.meta)}</div>
    <p class="bd-connect-foot">${icon("key")}<span>${keys
      ? t("Para ligar: põe a chave que falta no ficheiro backend/.env deste PC e reinicia o Hub. Os números aparecem sozinhos.")
      : t("As chaves estão postas, mas o serviço não respondeu. Confirma se a chave ainda é válida e reinicia o Hub.")}</span></p>
  </section>`;
}

const shKpi = (label, value) => `<div class="panel bd-kpi"><span class="bd-l">${t(label)}</span>${ui.num(value)}</div>`;
const shHead = (title, right = "") => `<header class="bd-ph"><b>${t(title)}</b>${right ? `<span>${right}</span>` : ""}</header>`;

// sales per day, oldest first: the last bar is today
function shBars(days, currency) {
  const top = Math.max(1, ...days), now = new Date();
  return `<div class="bd-bars">${days.map((v, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days.length - 1 - i));
    const when = d.toLocaleDateString("pt-PT", { weekday: "short", day: "numeric", month: "short" });
    return `<div class="bd-bar ${i === days.length - 1 ? "last" : ""}" title="${esc(when)} · ${shMoney(v, currency)}">
      <i style="height:${v ? Math.max(5, v / top * 100) : 2}%"></i><span>${d.getDate()}</span></div>`;
  }).join("")}</div>`;
}

const shOrders = (shop) => (shop.recent.length
  ? `<div class="bd-orders">${shop.recent.map((o) => `<div class="bd-order"><b>${esc(o.name)}</b><span class="ell grow">${esc(o.items)}</span>
      <span class="faint">${fmt.ago(o.at)}</span><b class="mono">${shMoney(o.total, shop.currency)}</b></div>`).join("")}</div>`
  : `<p class="faint bd-none">${t("Ainda sem vendas nos últimos 30 dias.")}</p>`);

function shTop(shop) {
  const top = Math.max(1, ...(shop.top || []).map((x) => x.qty));
  return `<section class="panel pad">${shHead("Mais vendidos", t("30 dias"))}${(shop.top || []).length
    ? `<div class="bd-top">${shop.top.map((x) => `<div><span class="ell">${esc(x.title)}</span><i><em style="width:${x.qty / top * 100}%"></em></i><b class="mono">${shInt(x.qty)}</b></div>`).join("")}</div>`
    : `<p class="faint bd-none">${t("Ainda sem vendas nos últimos 30 dias.")}</p>`}</section>`;
}

function shFunnel(a) {
  const cost = a.purchases && a.spend ? a.spend / a.purchases : null; // calculated from Meta's own spend and purchases
  const steps = [["Visualizações da página", a.views], ["Viram um produto", a.product_views], ["Carrinhos", a.carts], ["Checkouts", a.checkouts], ["Compras", a.purchases]];
  const top = Math.max(1, ...steps.map(([, n]) => n || 0));
  return `<section class="panel pad">${shHead("Anúncios · do clique à compra", `${t("{n} de alcance", { n: shInt(a.reach) })} · ${t("{n} cliques", { n: shInt(a.clicks) })}`)}
    <div class="bd-funnel">${steps.map(([label, n], i) => {
      const before = i ? steps[i - 1][1] : null;
      return `<div><span>${t(label)}</span><i><em style="width:${(n || 0) / top * 100}%"></em></i><b class="mono">${shInt(n)}</b>
        <small>${before && n != null ? shPct(n / before * 100) : ""}</small></div>`;
    }).join("")}</div>
    <div class="bd-foot"><span>${t("Custo por compra")} <b>${cost == null ? "—" : shMoney(cost, "EUR")}</b></span>
      <span>${t("Valor das compras")} <b>${a.purchase_value == null ? "—" : shMoney(a.purchase_value, "EUR")}</b></span></div></section>`;
}

// How the ads were delivered and what a click cost: eight small figures in a row, each with what it means under it.
function shAds(a) {
  const buy = a.purchases && a.clicks ? a.purchases / a.clicks * 100 : null;
  const cells = [
    ["Impressões", shInt(a.impressions), "vezes que o anúncio apareceu"],
    ["Alcance", shInt(a.reach), "pessoas diferentes que o viram"],
    ["Frequência", a.frequency == null ? "—" : a.frequency.toFixed(2).replace(".", ",") + "×", "vezes por pessoa; acima de 3 cansa"],
    ["CPM", shMoney(a.cpm, "EUR"), "custo de mil impressões"],
    ["Cliques", shInt(a.clicks), "cliques na ligação para a loja"],
    ["CTR", a.ctr == null ? "—" : shPct(a.ctr), "cliques por impressão; bom acima de 1%"],
    ["CPC", shMoney(a.cpc, "EUR"), "custo de cada clique"],
    ["Compra por clique", buy == null ? "—" : shPct(buy), "cliques que acabam em compra"],
  ];
  return `<section class="panel pad">${shHead("Anúncios · entrega e cliques", "Meta Ads")}
    <div class="bd-stats">${cells.map(([label, value, hint]) => `<div><span class="bd-l">${t(label)}</span><b class="mono">${value}</b><small>${t(hint)}</small></div>`).join("")}</div></section>`;
}

// Campaign by campaign, the one that spends most first: where the money goes and what it brings back.
function shCampaigns(a) {
  const rows = a.campaigns || [];
  if (!rows.length) return `<section class="panel pad">${shHead("Campanhas")}<p class="faint bd-none">${t("Nenhuma campanha gastou neste período.")}</p></section>`;
  const top = Math.max(...rows.map((c) => c.spend));
  return `<section class="panel pad">${shHead("Campanhas", t("por gasto"))}
    <div class="bd-scroll"><table class="bd-camp"><thead><tr><th>${t("Campanha")}</th><th>${t("Gasto")}</th><th>${t("Cliques")}</th><th>CTR</th><th>CPC</th>
      <th>${t("Compras")}</th><th>${t("Custo por compra")}</th><th>ROAS</th></tr></thead>
    <tbody>${rows.map((c) => `<tr><td><span class="ell" title="${esc(c.name)}">${esc(c.name)}</span><i><em style="width:${c.spend / top * 100}%"></em></i></td>
      <td>${shMoney(c.spend, "EUR")}</td><td>${shInt(c.clicks)}</td><td>${c.ctr == null ? "—" : shPct(c.ctr)}</td><td>${shMoney(c.cpc, "EUR")}</td>
      <td>${shInt(c.purchases)}</td><td>${c.purchases ? shMoney(c.spend / c.purchases, "EUR") : "—"}</td>
      <td class="${c.roas == null ? "" : c.roas >= 2 ? "good" : c.roas < 1 ? "bad" : ""}">${c.roas == null ? "—" : shRoas(c.roas)}</td></tr>`).join("")}</tbody></table></div></section>`;
}

// The shop in one page: the numbers that matter, then the sales, then what sells and what the ads bring.
function drawShop(s, p) {
  const shop = s.shopify, ads = s.meta, shopOn = shop.source === "live", adsOn = ads.source === "live";
  if (!shopOn && !adsOn) return shOffline(s);
  const w = shopOn ? shop[p] : null, a = adsOn ? ads[p] : null;
  const missing = [shopOn ? "" : shLink("shopify", shop), adsOn ? "" : shLink("meta", ads)].join("");
  return `<div class="bd-kpis">
      ${shKpi("Faturação", shopOn ? shMoney(w.revenue, shop.currency) : null)}
      ${shKpi("Vendas", shopOn ? w.orders : null)}
      ${shKpi("Ticket médio", shopOn && w.aov != null ? shMoney(w.aov, shop.currency) : null)}
      ${shKpi("Gasto em anúncios", adsOn ? shMoney(a.spend, "EUR") : null)}
      ${shKpi("ROAS", adsOn && a.roas != null ? shRoas(a.roas) : null)}
      ${shKpi("Faturação ÷ anúncios", shopOn && adsOn && a.spend ? shRoas(w.revenue / a.spend) : null)}</div>
    ${missing ? `<section class="panel bd-connect slim">${missing}</section>` : ""}
    ${shopOn ? `<div class="bd-cols">
      <section class="panel pad">${shHead("Faturação por dia", t("últimos 14 dias"))}${shBars(shop.days, shop.currency)}</section>
      <section class="panel pad">${shHead("Últimas vendas")}${shOrders(shop)}</section></div>` : ""}
    ${shopOn && adsOn ? `<div class="bd-cols even">${shTop(shop)}${shFunnel(a)}</div>` : shopOn ? shTop(shop) : shFunnel(a)}
    ${adsOn ? shAds(a) + shCampaigns(a) : ""}`;
}

// Beside the title: live with the time of the figures and the period, or plainly not connected.
function shTools(s) {
  const el = $("bd-tools");
  if (!el) return;
  const live = s.shopify.source === "live" || s.meta.source === "live";
  paint(el, live
    ? `<span class="bd-state st ok"><i></i>${t("Ao vivo · {h}", { h: fmt.hhmm(s.at) })}</span>
      <div class="segx">${SHOP_PERIODS.map(([v, l]) => `<button data-p="${v}" class="${v === shopPeriod ? "on" : ""}">${t(l)}</button>`).join("")}</div>`
    : `<span class="bd-state st wait"><i></i>${t("Loja por ligar")}</span>`);
}

// A section of the company (Tema, Fotos, Vídeos...): the same lists and galleries as in Empresas, inside this page.
async function bdSection(company, section) {
  const body = $("bd-body");
  const data = await api(`/api/hub/${company.id}/${section.id}`);
  if ($("bd-body") !== body) return; // the person went elsewhere meanwhile
  const away = data.missing?.length ? t("Não encontrei neste PC: {x}.", { x: data.missing.join(", ") }) : "";
  const render = { cards: renderCards, static: renderCards, files: renderFiles, videos: renderMedia, photos: renderMedia, sites: renderSites }[data.kind];
  if (!data.items.length) { body.innerHTML = `<div class="panel">${ui.empty(section.id, "Ainda não há nada aqui", away || section.description || "")}</div>`; return; }
  body.innerHTML = away ? `<p class="bd-away">${icon("alert")}<span>${esc(away)}</span></p>` : "";
  render(body, { company, section, data });
}

HUB_VIEWS.baredesk = async function (r) {
  await lazyFile("hub/baredesk.css").catch(() => {});
  const company = companies.find((c) => c.id === "baredesk");
  if (!company) { page(ui.empty("building", "BareDesk não está na biblioteca", "Falta library/companies/baredesk.")); return; }
  const sections = [{ id: "loja", label: "Loja", icon: "bag" }, ...company.sections];
  const current = sections.find((x) => x.id === r.company) || sections[0], shop = current.id === "loja";
  page(`<div class="bd-page">${ui.head("Trabalho", "BareDesk", company.tagline || "", shop ? `<div class="bd-tools" id="bd-tools"></div>` : "")}
    <nav class="bd-nav">${sections.map((x) => `<a class="bd-pill ${x === current ? "on" : ""}" href="#/baredesk${x.id === "loja" ? "" : "/" + x.id}">${icon(x.id === "loja" ? "bag" : x.id)}<span>${esc(t(x.label))}</span>${x.count ? `<i>${x.count}</i>` : ""}</a>`).join("")}</nav>
    ${shop ? "" : `<p class="bd-desc">${esc(current.description || "")}</p>`}<div class="${shop ? "bd" : "bd-sec"}" id="bd-body"></div></div>`);
  if (!shop) { shopReload = null; await bdSection(company, current); return; }
  const load = () => mount($("bd-body"), async () => {
    const s = await api("/api/store/summary");
    const newest = s.shopify.recent?.[0];
    if (newest && shopSeen && newest.name !== shopSeen) flash(t("Nova venda na BareDesk: {n} · {v}", { n: newest.name, v: shMoney(newest.total, s.shopify.currency) }));
    if (newest) shopSeen = newest.name;
    shTools(s);
    return drawShop(s, shopPeriod);
  }, 5);
  shopReload = load;
  $("bd-tools").onclick = (e) => {
    const b = e.target.closest("[data-p]");
    if (!b) return;
    shopPeriod = b.dataset.p;
    b.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    load();
  };
  await load();
};

// The shop moves while the page is open: refresh every minute, only while the shop is on screen.
setInterval(() => { if (shopReload && $("bd-tools")) shopReload(); }, 60000);
