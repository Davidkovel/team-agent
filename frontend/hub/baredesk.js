// BareDesk: the shop, in its own section of the sidebar. The tabs on top of the page are Resumo, Vendas and Anúncios.
// Shopify (sales) and Meta Ads come from /api/store/summary, which the Hub keeps for 45 s. A figure is live or it says it is
// missing: never a made-up zero.

let shopPeriod = "today";
let shopSeen = null;   // the newest order already seen, so a new sale rings once
let shopReload = null; // reloads the page on screen; the minute timer below calls it
const SHOP_PERIODS = [["today", "Hoje"], ["week", "7 dias"], ["month", "30 dias"]];

const shMoney = (n, currency) => (n == null ? "—" : fmt.money(n, currency || "EUR"));
const shInt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("pt-PT"));
const shRoas = (n) => n.toFixed(2).replace(".", ",") + "×";
const shPct = (n) => n.toFixed(n < 10 ? 1 : 0).replace(".", ",") + "%";

const shOff = (what, key) => `<div class="sh-off">${icon("alert")}<div><b>${t("{x} por ligar", { x: what })}</b>
  <span>${t("Falta {k} no backend/.env deste PC.", { k: key })}</span></div></div>`;
const shBad = (what, err) => `<div class="sh-off bad">${icon("alert")}<div><b>${t("{x} não respondeu", { x: what })}</b><span>${esc(err)}</span></div></div>`;
const shMissing = (what, block) => (block.source === "error" ? shBad(what, block.error) : shOff(what, block.missing));

const shKpi = (label, value) => `<div class="panel bd-kpi"><span class="bd-l">${t(label)}</span>${ui.num(value)}</div>`;
const shHead = (title, right = "") => `<header class="bd-ph"><b>${t(title)}</b>${right ? `<span>${right}</span>` : ""}</header>`;
const shSeeAll = (href) => `<a href="${href}">${t("Ver tudo")}</a>`;

// sales per day, oldest first: the last bar is today
function shBars(days, currency, tall = false) {
  const top = Math.max(1, ...days), now = new Date();
  return `<div class="bd-bars ${tall ? "tall" : ""}">${days.map((v, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days.length - 1 - i));
    const when = d.toLocaleDateString("pt-PT", { weekday: "short", day: "numeric", month: "short" });
    return `<div class="bd-bar ${i === days.length - 1 ? "last" : ""}" title="${esc(when)} · ${shMoney(v, currency)}">
      <i style="height:${v ? Math.max(5, v / top * 100) : 2}%"></i><span>${d.getDate()}</span></div>`;
  }).join("")}</div>`;
}

const shOrders = (shop, count = 5) => (shop.recent.length
  ? `<div class="bd-orders">${shop.recent.slice(0, count).map((o) => `<div class="bd-order"><b>${esc(o.name)}</b><span class="ell grow">${esc(o.items)}</span>
      <span class="faint">${fmt.ago(o.at)}</span><b class="mono">${shMoney(o.total, shop.currency)}</b></div>`).join("")}</div>`
  : `<p class="faint bd-none">${t("Ainda sem vendas nos últimos 30 dias.")}</p>`);

/* ---------- Resumo ---------- */
function drawShopSummary(s, p) {
  const shop = s.shopify, ads = s.meta, shopOn = shop.source === "live", adsOn = ads.source === "live";
  const w = shopOn ? shop[p] : null, a = adsOn ? ads[p] : null;
  return `<div class="bd-kpis">
      ${shKpi("Faturação", shopOn ? shMoney(w.revenue, shop.currency) : null)}
      ${shKpi("Vendas", shopOn ? w.orders : null)}
      ${shKpi("Ticket médio", shopOn && w.aov != null ? shMoney(w.aov, shop.currency) : null)}
      ${shKpi("Gasto em anúncios", adsOn ? shMoney(a.spend, "EUR") : null)}
      ${shKpi("ROAS", adsOn && a.roas != null ? shRoas(a.roas) : null)}</div>
    ${shopOn ? "" : shMissing("Shopify", shop)}${adsOn ? "" : shMissing("Meta Ads", ads)}
    ${shopOn ? `<div class="bd-cols">
      <section class="panel pad">${shHead("Faturação por dia", t("últimos 14 dias"))}${shBars(shop.days, shop.currency, true)}</section>
      <section class="panel pad">${shHead("Últimas vendas", shSeeAll("#/vendas"))}${shOrders(shop)}</section></div>` : ""}`;
}

/* ---------- Vendas ---------- */
function drawShopSales(s, p) {
  const shop = s.shopify;
  if (shop.source !== "live") return `<div class="panel pad">${shMissing("Shopify", shop)}</div>`;
  const w = shop[p], best = Math.max(0, ...shop.days), top = Math.max(1, ...(shop.top || []).map((x) => x.qty));
  return `<div class="bd-kpis three">
      ${shKpi("Vendas", w.orders)}${shKpi("Faturação", shMoney(w.revenue, shop.currency))}${shKpi("Ticket médio", w.aov != null ? shMoney(w.aov, shop.currency) : null)}</div>
    <section class="panel pad">${shHead("Faturação por dia", best ? t("melhor dia: {v}", { v: shMoney(best, shop.currency) }) : t("últimos 14 dias"))}${shBars(shop.days, shop.currency, true)}</section>
    <div class="bd-cols even">
      <section class="panel pad">${shHead("Últimas vendas")}${shOrders(shop)}</section>
      <section class="panel pad">${shHead("Mais vendidos", t("30 dias"))}${(shop.top || []).length
        ? `<div class="bd-top">${shop.top.map((x) => `<div><span class="ell">${esc(x.title)}</span><i><em style="width:${x.qty / top * 100}%"></em></i><b class="mono">${shInt(x.qty)}</b></div>`).join("")}</div>`
        : `<p class="faint bd-none">${t("Ainda sem vendas nos últimos 30 dias.")}</p>`}</section></div>`;
}

/* ---------- Anúncios ---------- */
function drawShopAds(s, p) {
  const ads = s.meta;
  if (ads.source !== "live") return `<div class="panel pad">${shMissing("Meta Ads", ads)}</div>`;
  const a = ads[p];
  const cost = a.purchases && a.spend ? a.spend / a.purchases : null; // calculated from Meta's own spend and purchases
  const steps = [["Visualizações da página", a.views], ["Viram um produto", a.product_views], ["Carrinhos", a.carts], ["Checkouts", a.checkouts], ["Compras", a.purchases]];
  const top = Math.max(1, ...steps.map(([, n]) => n || 0));
  return `<div class="bd-kpis">
      ${shKpi("Gasto", shMoney(a.spend, "EUR"))}${shKpi("Compras", a.purchases == null ? null : shInt(a.purchases))}
      ${shKpi("Custo por compra", cost == null ? null : shMoney(cost, "EUR"))}${shKpi("Valor das compras", a.purchase_value == null ? null : shMoney(a.purchase_value, "EUR"))}
      ${shKpi("ROAS", a.roas == null ? null : shRoas(a.roas))}</div>
    <section class="panel pad">${shHead("Do anúncio à compra", `${t("{n} de alcance", { n: shInt(a.reach) })} · ${t("{n} cliques", { n: shInt(a.clicks) })}`)}
      <div class="bd-funnel">${steps.map(([label, n], i) => {
        const before = i ? steps[i - 1][1] : null;
        return `<div><span>${t(label)}</span><i><em style="width:${(n || 0) / top * 100}%"></em></i><b class="mono">${shInt(n)}</b>
          <small>${before && n != null ? shPct(n / before * 100) : ""}</small></div>`;
      }).join("")}</div></section>`;
}

// One page of the section: the title, the period, and the body that loads (and reloads by itself) under it.
function shopPage(title, sub, draw) {
  return async function () {
    const periods = `<div class="segx" id="bd-period">${SHOP_PERIODS.map(([v, l]) => `<button data-p="${v}" class="${v === shopPeriod ? "on" : ""}">${t(l)}</button>`).join("")}</div>`;
    page(`${ui.head("BareDesk", t(title), t(sub), `<span class="bd-live" id="bd-live"></span>${periods}`)}<div class="bd" id="bd-body"></div>`);
    const load = () => mount($("bd-body"), async () => {
      const s = await api("/api/store/summary");
      const newest = s.shopify.recent?.[0];
      if (newest && shopSeen && newest.name !== shopSeen) flash(t("Nova venda na BareDesk: {n} · {v}", { n: newest.name, v: shMoney(newest.total, s.shopify.currency) }));
      if (newest) shopSeen = newest.name;
      const live = $("bd-live");
      if (live) live.innerHTML = s.shopify.source === "live" || s.meta.source === "live"
        ? `<span class="src live">● ${t("Ao vivo")}</span><span class="faint">${t("atualizado {h}", { h: fmt.hhmm(s.at) })}</span>` : "";
      return draw(s, shopPeriod);
    }, 5);
    shopReload = load;
    $("bd-period").onclick = (e) => {
      const b = e.target.closest("[data-p]");
      if (!b) return;
      shopPeriod = b.dataset.p;
      $("bd-period").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      load();
    };
    await load();
  };
}

HUB_VIEWS.baredesk = shopPage("Resumo da loja", "As vendas e os anúncios num só olhar.", drawShopSummary);
HUB_VIEWS.vendas = shopPage("Vendas", "O que a loja Shopify faturou e vendeu.", drawShopSales);
HUB_VIEWS.anuncios = shopPage("Anúncios", "O que o Meta Ads gastou e quanto chegou a compras.", drawShopAds);

// The shop moves while the page is open: refresh every minute, only when a BareDesk page is on screen.
setInterval(() => { if ($("bd-body") && shopReload) shopReload(); }, 60000);
