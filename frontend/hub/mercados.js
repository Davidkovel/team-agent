// Mercados: the trading desk of the Hub (backend/app/routers/trading.py), fetched the first time somebody opens it.
// Built around what the team trades (FOCUS on the Hub: gold, EUR/USD, GER40, GBP/USD; Marco, 9 Oct): four cards with the
// price and TradingView's signal, the news about them in Portuguese as cards with a photo or the market's own picture and
// a three-point summary (read whole inside the Hub), and the week's diary. The rest of David's desk (strategy tests,
// insiders, investors, heatmaps) is one click away under «Mais». A figure is live or it says it is missing: never a made-up zero.

const MK = { tab: "painel", symbol: localStorage.getItem("mk.symbol") || "OANDA:XAUUSD", topic: "all", ins: "buys", map: "stocks",
  board: null, last: {}, timer: null, beat: 0, charts: {}, hist: {}, feed: null, cal: null,
  tk: { side: "buy", mode: "amount", symbol: "", name: "", quote: null },
  bt: { symbol: "", strat: "sma", range: "2y", capital: 10000, fee: 0.1, params: {}, result: null, ranking: null } };
const MK_TABS = [["painel", "Painel", "candles"], ["noticias", "Notícias", "news"], ["grafico", "Gráfico", "trend"], ["paper", "Paper trading", "wallet"]];
const MK_MORE = [["estrategias", "Estratégias", "flask"], ["insiders", "Insiders", "users"], ["investidores", "Investidores", "eye"], ["mapas", "Mapas", "grid"]];
// the team's four, as the Hub sends them in /board; also what the chart's pills and the news filter offer
const MK_FOCUS = [["gold", "OANDA:XAUUSD", "XAU/USD", "Ouro"], ["eurusd", "FX:EURUSD", "EUR/USD", "Euro · Dólar"],
  ["ger40", "OANDA:DE30EUR", "GER40", "DAX · Alemanha"], ["gbpusd", "FX:GBPUSD", "GBP/USD", "Libra · Dólar"]];
const MK_TOPIC = { gold: "Ouro", eurusd: "EUR/USD", ger40: "GER40", gbpusd: "GBP/USD", usd: "Dólar" };
const MK_FLAGS = { gold: ["metal/gold"], eurusd: ["country/EU", "country/US"], ger40: ["country/DE"], gbpusd: ["country/GB", "country/US"], usd: ["country/US"],
  USD: ["country/US"], EUR: ["country/EU"], GBP: ["country/GB"] };
const MK_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
const MK_COLORS = { strat: "#3987e5", hold: "#d95926" }; // validated pair on the dark surface (dataviz validator)

/* ---------- numbers ---------- */
const mkFx = (n, d) => Number(n).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });
function mkPrice(n) {
  if (n == null) return "—";
  const a = Math.abs(n);
  return mkFx(n, a >= 10 ? 2 : a >= 0.01 ? 4 : 6);
}
// forex is read to the fifth decimal (the pip and its tenth); everything else as mkPrice
const mkQuote = (q) => (q.price == null ? "—" : /forex/.test(q.type || "") || /USD$/.test(q.code || "") && q.price < 20 ? mkFx(q.price, 5) : mkPrice(q.price));
const mkPct = (n) => (n == null ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + mkFx(Math.abs(n), Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2) + "%");
const mkUsd = (n, d = 2) => (n == null ? "—" : (n < 0 ? "−" : "") + "$" + mkFx(Math.abs(n), d));
const mkSignedUsd = (n) => (n == null ? "—" : Math.abs(n) < 0.005 ? "$0,00" : (n > 0 ? "+" : "−") + "$" + mkFx(Math.abs(n), 2));
function mkBig(n, money = false) {
  if (n == null) return "—";
  const a = Math.abs(n), pre = money ? "$" : "";
  for (const [v, s] of [[1e12, " T"], [1e9, " B"], [1e6, " M"], [1e3, " k"]]) if (a >= v) return pre + mkFx(n / v, a / v >= 100 ? 0 : 1) + s;
  return pre + mkFx(n, 0);
}
const mkTone = (n) => (n == null || Math.abs(n) < 1e-6 ? "" : n > 0 ? "up" : "down");
const mkTicker = (sym) => (sym || "").split(":")[1] || sym || "";
const mkGo = (sym) => `#/mercados/grafico/${encodeURIComponent(sym)}`;
const mkDate = (ts) => new Date(ts * 1000).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", year: "2-digit" });
const MK_RATE = { strong_buy: ["Compra forte", "up2"], buy: ["Compra", "up"], neutral: ["Neutro", "flat"], sell: ["Venda", "down"], strong_sell: ["Venda forte", "down2"] };
const mkRate = (r) => (r ? `<span class="mk-rate ${MK_RATE[r][1]}">${t(MK_RATE[r][0])}</span>` : `<span class="mk-rate none">—</span>`);
const mkChg = (q) => `<span class="mk-chg ${mkTone(q.change_pct)}">${q.change_pct == null ? "—" : `${q.change_pct > 0 ? "▲" : q.change_pct < 0 ? "▼" : ""} ${mkPct(q.change_pct)}`}</span>`;
function mkLogo(q, cls = "") {
  const letter = esc((mkTicker(q.symbol)[0] || "?").toUpperCase());
  return `<span class="mk-logo ${cls}"><b>${letter}</b>${q.logo ? `<img src="${esc(q.logo)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>`;
}
// a market's own picture: the gold coin, the flags of a pair (TradingView's round logos), one over the other
function mkFlags(key, cls = "") {
  const ids = MK_FLAGS[key] || [];
  return `<span class="mk-flags ${cls} n${ids.length}">${ids.map((id) => `<img src="https://s3-symbol-logo.tradingview.com/${id}.svg" alt="" loading="lazy" onerror="this.remove()">`).join("")}</span>`;
}
const mkHead = (title, right = "") => `<header class="bd-ph"><b>${t(title)}</b>${right ? `<span>${right}</span>` : ""}</header>`;
const mkNone = (text) => `<p class="faint mk-none">${esc(t(text))}</p>`;

function mkSetSymbol(sym, name = "") {
  if (!sym) return;
  MK.symbol = sym;
  localStorage.setItem("mk.symbol", sym);
  if (name) MK.names = { ...(MK.names || {}), [sym]: name };
}

/* ---------- TradingView's own widgets ---------- */
function mkTv(el, name, config) {
  if (!el) return;
  el.innerHTML = `<div class="tradingview-widget-container" style="height:100%;width:100%"><div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div></div>`;
  const s = document.createElement("script");
  s.type = "text/javascript";
  s.async = true;
  s.src = `https://s3.tradingview.com/external-embedding/embed-widget-${name}.js`;
  s.textContent = JSON.stringify({ colorTheme: "dark", isTransparent: true, locale: "br", ...config });
  el.firstElementChild.append(s);
}

/* ---------- a symbol picker: anything TradingView has ---------- */
function mkPick(title, onPick) {
  openModal(`<h3>${esc(t(title))}</h3>
    <input class="mk-pick-in" id="mk-pick-q" placeholder="${esc(t("Procura: Apple, BTC, ouro, EURUSD, SAP, S&P 500…"))}" autocomplete="off" spellcheck="false">
    <div class="mk-pick-list" id="mk-pick-list">${ui.skeleton(4)}</div>`);
  const q = $("mk-pick-q"), list = $("mk-pick-list");
  let turn = 0, items = [], timer = null;
  const done = (x) => { closeModal(); onPick({ symbol: x.id, name: x.name || x.symbol }); };
  const load = async () => {
    const my = ++turn;
    const res = await api(`/api/markets/tv?q=${encodeURIComponent(q.value.trim())}`).catch(() => []);
    if (my !== turn || !list.isConnected) return;
    items = res;
    list.innerHTML = res.length ? res.map((x, i) => `<button type="button" class="mk-pick-row" data-i="${i}"><b>${esc(x.symbol)}</b>
      <span class="ell">${esc(x.name)}</span><small>${esc(x.exchange)}${x.type ? " · " + esc(x.type) : ""}</small></button>`).join("")
      : mkNone("Nada encontrado.");
  };
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(load, 220); };
  q.onkeydown = (e) => { if (e.key === "Enter" && items[0]) { e.preventDefault(); done(items[0]); } };
  list.onclick = (e) => { const b = e.target.closest("[data-i]"); if (b) done(items[Number(b.dataset.i)]); };
  load();
  setTimeout(() => q.focus(), 30);
}

/* ---------- the page ---------- */
HUB_VIEWS.mercados = async function (r) {
  const all = MK_TABS.concat(MK_MORE);
  const tab = all.some(([id]) => id === r.company) ? r.company : "painel";
  const arg = r.section ? decodeURIComponent(r.section) : "";
  if (tab === "grafico" && arg) mkSetSymbol(arg);
  MK.tab = tab;
  let root = document.querySelector("#view .mk");
  if (!root) { // the shell stays while moving between the sections
    page(`<div class="mk">
      <header class="ph mk-top"><div><div class="ph-eyebrow">${t("Mercados · os nossos quatro")}</div><h1>${t("Mercados")}</h1>
        <p>${t("Ouro, EUR/USD, GER40 e GBP/USD: o preço, o sinal e as notícias que mexem com eles, em português.")}</p></div>
        <div class="ph-actions"><span class="mk-live" id="mk-live"></span>
          <button class="btn primary" data-ask>${icon("spark")}${t("Pergunta ao Claude")}</button></div></header>
      <nav class="bd-nav mk-nav">${MK_TABS.map(([id, label, ic]) => `<a class="bd-pill" data-tab="${id}" href="#/mercados/${id}">${icon(ic)}<span>${t(label)}</span></a>`).join("")}
        <div class="mk-more"><button type="button" class="bd-pill" data-more>${icon("grid")}<span id="mk-more-l">${t("Mais")}</span>${icon("chevron")}</button>
          <div class="mk-more-m" id="mk-more-m" hidden>${MK_MORE.map(([id, label, ic]) => `<a data-tab="${id}" href="#/mercados/${id}">${icon(ic)}<span>${t(label)}</span></a>`).join("")}</div></div></nav>
      <div id="mk-body"></div></div>`);
    root = document.querySelector("#view .mk");
    root.addEventListener("click", mkClick);
    root.addEventListener("submit", mkSubmit);
    root.addEventListener("input", mkInput);
  }
  root.querySelectorAll(".mk-nav [data-tab]").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
  const extra = MK_MORE.find(([id]) => id === tab);
  root.querySelector("[data-more]").classList.toggle("on", !!extra);
  $("mk-more-l").textContent = extra ? t(extra[1]) : t("Mais");
  $("mk-more-m").hidden = true;
  const body = $("mk-body");
  body.className = `mk-body mk-${tab}`;
  body.innerHTML = "";
  MK.charts = {};
  await MK_VIEWS[tab](body, arg);
  mkStartTimer();
};

// The page moves while it is open: prices every 20 s, the news every minute (the Hub asks its sources every five).
// Only while it is on screen.
function mkStartTimer() {
  if (MK.timer) return;
  MK.timer = setInterval(() => {
    if (!document.querySelector("#view .mk")) { clearInterval(MK.timer); MK.timer = null; return; }
    if (document.hidden) return;
    MK.beat++;
    const tab = MK.tab;
    if (tab === "painel") { mkLoadBoard(); if (MK.beat % 3 === 0) mkLoadFeed(true); if (MK.beat % 15 === 0) mkLoadCal(); else mkPaintCal(); }
    if (tab === "grafico") mkLoadSymbol(true);
    if (tab === "noticias" && MK.beat % 3 === 0) { mkLoadFeed(true); mkPaintCal(); }
    if (tab === "paper") mkLoadPaper(true);
  }, 20000);
}

function mkLive(at) {
  const el = $("mk-live");
  if (el) el.innerHTML = `<span class="src live">● ${t("Ao vivo")}</span><span class="faint">${t("atualizado {h}", { h: fmt.hhmm(at || new Date().toISOString()) })}</span>`;
}

/* ---------- clicks, forms and inputs of the whole page ---------- */
async function mkClick(e) {
  const more = $("mk-more-m");
  if (more && !more.hidden && !e.target.closest(".mk-more")) more.hidden = true;
  const el = e.target.closest("[data-more],[data-ask],[data-alert],[data-alert-del],[data-trade],[data-topic],[data-news],[data-ins-view],[data-follow],[data-map],[data-tk-pick],[data-tk-side],[data-tk-mode],[data-tk-pct],[data-tk-focus],[data-paper-reset],[data-bt-pick],[data-bt-range],[data-bt-all],[data-bt-strat],[data-ask-q],[data-sym-pick],[data-inv],[data-sym]");
  if (!el || el.closest("a[href^='http']")) return;
  const d = el.dataset;
  if (d.more !== undefined) { more.hidden = !more.hidden; return; }
  if (d.symPick !== undefined) return mkPick("Abrir um símbolo", (x) => { mkSetSymbol(x.symbol, x.name); location.hash = mkGo(x.symbol); });
  if (d.ask !== undefined) return mkAskModal(d.ask || "");
  if (d.askQ) { const form = el.closest("form"); form.querySelector("textarea").value = d.askQ; return form.requestSubmit(); }
  if (d.alert) { e.preventDefault(); e.stopPropagation(); return mkAlertModal(d.alert, d.name || "", Number(d.price) || null); }
  if (d.alertDel) { e.stopPropagation(); await api(`/api/trading/items/${d.alertDel}`, { method: "DELETE" }); return mkLoadBoard(); }
  if (d.trade) {
    e.preventDefault(); e.stopPropagation();
    Object.assign(MK.tk, { symbol: d.trade, name: d.name || "", side: d.side || "buy", quote: null });
    location.hash = "#/mercados/paper";
    return;
  }
  if (d.topic) { MK.topic = d.topic; return mkPaintFeed(); }
  if (d.news) { const x = (MK.feed?.items || []).concat(MK.symNews || []).find((n) => n.id === d.news); if (x) mkReader(x); return; }
  if (d.insView) { MK.ins = d.insView; return mkLoadInsiders(); }
  if (d.follow) { e.preventDefault(); e.stopPropagation(); return mkFollow(d.follow, d.name || "", d.item || ""); }
  if (d.map) { MK.map = d.map; return mkPaintMap(); }
  if (d.tkPick !== undefined) return mkPick("Símbolo da ordem", (x) => { Object.assign(MK.tk, { symbol: x.symbol, name: x.name, quote: null }); mkPaintTicket(); mkTicketQuote(); });
  if (d.tkFocus) { Object.assign(MK.tk, { symbol: d.tkFocus, name: d.name || "", quote: null }); mkPaintTicket(); return mkTicketQuote(); }
  if (d.tkSide) { MK.tk.side = d.tkSide; if (d.tkSide === "sell") MK.tk.mode = "qty"; return mkPaintTicket(); }
  if (d.tkMode) { MK.tk.mode = d.tkMode; return mkPaintTicket(); }
  if (d.tkPct) return mkTicketPct(Number(d.tkPct));
  if (d.paperReset !== undefined) return mkResetModal();
  if (d.btPick !== undefined) return mkPick("Símbolo a testar", (x) => { MK.bt.symbol = x.symbol; MK.bt.name = x.name; mkPaintBtForm(); });
  if (d.btRange) { MK.bt.range = d.btRange; mkPaintBtForm(); return mkRunBt(); }
  if (d.btAll !== undefined) return mkRunAll();
  if (d.btStrat) { MK.bt.strat = d.btStrat; MK.bt.params = {}; mkPaintBtForm(); return mkRunBt(); }
  if (d.inv) { location.hash = `#/mercados/investidores/${d.inv}`; return; }
  const inner = e.target.closest("button,input,select,textarea");
  if (d.sym && (!inner || inner === el)) { e.preventDefault(); mkSetSymbol(d.sym, d.name || ""); location.hash = mkGo(d.sym); }
}

function mkSubmit(e) {
  const form = e.target;
  if (form.id === "mk-tk") { e.preventDefault(); mkOrder(); }
  if (form.id === "mk-bt-f") { e.preventDefault(); mkRunBt(); }
  if (form.id === "mk-ins-f") { e.preventDefault(); mkInsiderCompany(form.querySelector("input").value.trim()); }
}

function mkInput(e) {
  if (e.target.id === "mk-tk-n") mkTicketSum();
  if (e.target.closest("#mk-bt-f") && e.target.name) {
    const v = Number(e.target.value);
    if (e.target.name === "capital") MK.bt.capital = v; else if (e.target.name === "fee") MK.bt.fee = v; else MK.bt.params[e.target.name] = v;
  }
}

/* ---------- Pergunta ao Claude ---------- */
const MK_ASK_MARKET = ["Como estão hoje o ouro, o EUR/USD, o GER40 e a libra?", "Que notícias de hoje mexem com os nossos quatro?",
  "O que há na agenda desta semana que possa mexer com o mercado?", "Que riscos vês na minha carteira de paper trading?"];
const mkAskSymbol = (s) => [`Faz a análise técnica de ${s} em linguagem simples`, `Que níveis de suporte e resistência devo vigiar em ${s}?`,
  `O que dizem as notícias de hoje sobre ${s}?`, `Há algum evento esta semana que possa mexer com ${s}?`];

function mkMd(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
}

function mkAskError(error) {
  if (error === "agent_offline") return `<div class="mk-ask-off">${icon("bot")}<div><b>${t("O teu agente automático não está ligado")}</b>
    <span>${t("O Hub não tem IA própria: quem responde é o Claude do teu agente, com estes dados. Liga o agente neste PC e pergunta outra vez.")}</span></div></div>`;
  if (error === "timeout") return `<div class="mk-ask-off">${icon("clock")}<div><b>${t("O agente não respondeu a tempo")}</b><span>${t("Tenta outra vez daqui a pouco.")}</span></div></div>`;
  return `<div class="mk-ask-off">${icon("alert")}<div><b>${t("Sem resposta")}</b><span>${esc(error || "")}</span></div></div>`;
}

async function mkAskRun(question, symbol, out) {
  if (!out) return;
  out.innerHTML = `<div class="mk-think"><i></i><i></i><i></i><span>${t("O Claude está a ler o mercado…")}</span></div>`;
  let req;
  try { req = await api("/api/trading/ask", { method: "POST", body: { question, symbol } }); }
  catch (e) { out.innerHTML = mkAskError(e.message); return; }
  const started = Date.now();
  while ((req.status === "PENDING" || req.status === "RUNNING") && Date.now() - started < 5 * 60000) {
    await new Promise((ok) => setTimeout(ok, 2000));
    if (!out.isConnected) return;
    req = await api(`/api/ai/requests/${req.id}`).catch(() => req);
  }
  if (!out.isConnected) return;
  out.innerHTML = req.status === "DONE"
    ? `<div class="mk-ans">${mkMd(req.answer)}<small>${t("Análise do Claude com os dados do Hub a {h}. Não é aconselhamento financeiro.", { h: fmt.hhmm(req.finished_at) })}</small></div>`
    : mkAskError(req.error || "timeout");
}

function mkAskForm(id, suggestions, placeholder) {
  return `<form id="${id}" class="mk-ask-f"><div class="mk-sugg">${suggestions.map((s) => `<button type="button" class="chp" data-ask-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>
    <div class="mk-ask-in"><textarea rows="2" maxlength="2000" placeholder="${esc(placeholder)}"></textarea><button class="btn primary">${icon("spark")}${t("Perguntar")}</button></div></form>`;
}

function mkAskModal(symbol) {
  const sym = symbol || "";
  openModal(`<h3>${t("Pergunta ao Claude")}</h3>
    <p class="faint mk-ask-sub">${sym ? t("Sobre {s}, com tudo o que o Hub sabe dele agora: preço, sinais do TradingView, indicadores e notícias.", { s: mkTicker(sym) })
      : t("Com o que o Hub sabe agora: os nossos quatro mercados, as notícias em português, a agenda da semana e a tua carteira de paper trading.")}</p>
    ${mkAskForm("mk-ask-modal", sym ? mkAskSymbol(mkTicker(sym)) : MK_ASK_MARKET, t("Escreve a tua pergunta…"))}
    <div id="mk-ask-modal-out" class="mk-ask-out"></div>
    <div class="form-foot"><button type="button" class="btn quiet" data-close>${t("Fechar")}</button></div>`);
  $("modal-box").classList.add("wide");
  const form = $("mk-ask-modal");
  form.onclick = (e) => { const b = e.target.closest("[data-ask-q]"); if (b) { form.querySelector("textarea").value = b.dataset.askQ; form.requestSubmit(); } };
  form.onsubmit = (e) => { e.preventDefault(); const q = form.querySelector("textarea").value.trim(); if (q) mkAskRun(q, sym, $("mk-ask-modal-out")); };
  setTimeout(() => form.querySelector("textarea").focus(), 30);
}

/* ---------- alerts ---------- */
function mkAlertModal(symbol, name, price) {
  formModal(t("Alerta de preço · {s}", { s: name || mkTicker(symbol) }), `
    <label class="field"><span>${t("Quando o preço")}</span><select name="op"><option value="above">${t("subir acima de")}</option><option value="below">${t("descer abaixo de")}</option></select></label>
    <label class="field"><span>${t("Preço")}${price ? ` · ${t("agora {p}", { p: mkPrice(price) })}` : ""}</span><input name="value" type="number" step="any" required value="${price ?? ""}"></label>
    <label class="field" style="grid-column:1/-1"><span>${t("Nota (opcional)")}</span><input name="note" maxlength="200" placeholder="${esc(t("Ex.: rompe a resistência, entrar"))}"></label>
    <p class="faint" style="grid-column:1/-1;margin:0">${t("O Hub deste PC vigia o preço a cada minuto e toca uma notificação aqui e no telemóvel.")}</p>`,
  async (v) => {
    await api("/api/trading/items", { method: "POST", body: { kind: "alert", symbol, name, op: v.op, value: Number(v.value), note: v.note || "" } });
    flash(t("Alerta criado"));
    mkLoadBoard();
  }, { submit: "Criar alerta" });
}

/* ================================================================ Painel */
const MK_VIEWS = {};

MK_VIEWS.painel = async (body) => {
  body.innerHTML = `<div class="mk-four" id="mk-four">${MK_FOCUS.map(() => `<div class="panel mk-fc">${ui.skeleton(3)}</div>`).join("")}</div>
    <div class="mk-cols">
      <section class="panel mk-card" id="mk-today">${mkHead("Notícias de hoje", `<a href="#/mercados/noticias">${t("Ver todas")} →</a>`)}<div class="mk-grid">${ui.skeleton(6)}</div></section>
      <aside class="mk-side">
        <section class="panel mk-card" id="mk-cal">${ui.skeleton(5)}</section>
        <section class="panel mk-card" id="mk-alerts"></section>
      </aside>
    </div>`;
  const board = mkLoadBoard(); // first: it is the fast one, and the browser only opens a few connections at a time
  mkLoadFeed();
  mkLoadCal();
  await board;
};

async function mkLoadBoard() {
  let b;
  try { b = await api("/api/trading/board"); } catch (e) { const w = $("mk-four"); if (w) w.innerHTML = ui.error(e.message); return; }
  MK.board = b;
  mkLive(b.fetched_at);
  const four = $("mk-four");
  if (four) four.innerHTML = b.focus.map(mkFourCard).join("");
  mkPaintAlerts();
  b.focus.forEach((q) => { if (q.price != null) MK.last[q.symbol] = q.price; });
}

// a price that moved since the last look blinks green or red, once
function mkFlashClass(q) {
  const before = MK.last[q.symbol];
  return before == null || q.price == null || before === q.price ? "" : q.price > before ? "tick-up" : "tick-down";
}

function mkFourCard(q) {
  const head = `<div class="mk-fc-h">${mkFlags(q.topic)}<div><b>${esc(q.code)}</b><span>${esc(t(q.label))}</span></div>
    <button class="tool" data-alert="${esc(q.symbol)}" data-name="${esc(q.code)}" data-price="${q.price ?? ""}" title="${t("Avisar-me quando o preço lá chegar")}">${icon("bell")}</button></div>`;
  if (q.missing) return `<article class="panel mk-fc" data-sym="${esc(q.symbol)}">${head}<p class="faint mk-none">${t("O TradingView não deu preço agora.")}</p></article>`;
  const span = q.high != null && q.low != null && q.high > q.low ? Math.max(0, Math.min(100, (q.price - q.low) / (q.high - q.low) * 100)) : null;
  return `<article class="panel mk-fc t-${q.topic}" data-sym="${esc(q.symbol)}" data-name="${esc(q.code)}">${head}
    <div class="mk-fc-p"><b class="mono ${mkFlashClass(q)}">${mkQuote(q)}</b>${mkChg(q)}</div>
    <div class="mk-range" title="${esc(t("Hoje: mínimo {l} · máximo {h}", { l: mkPrice(q.low), h: mkPrice(q.high) }))}">${span == null ? "" : `<i style="left:${span}%"></i>`}<small>${mkPrice(q.low)}</small><small>${mkPrice(q.high)}</small></div>
    <div class="mk-fc-s">${[["1 h", q.r1h], ["4 h", q.r4h], ["Dia", q.rating]].map(([l, r]) => `<div><span>${t(l)}</span>${mkRate(r)}</div>`).join("")}</div></article>`;
}

function mkPaintAlerts() {
  const el = $("mk-alerts");
  if (!el || !MK.board) return;
  const alerts = MK.board.alerts;
  el.innerHTML = mkHead("Alertas", alerts.length ? t("{n} ativos", { n: alerts.filter((a) => !a.fired_at).length }) : "")
    + (alerts.length ? `<div class="mk-al">${alerts.map((a) => {
      const q = MK.board.alert_quotes?.[a.symbol];
      const dist = q?.price ? (a.value / q.price - 1) * 100 : null;
      return `<div class="mk-al-r ${a.fired_at ? "fired" : ""}" data-sym="${esc(a.symbol)}">${icon("bell")}<div><b>${esc(a.name || mkTicker(a.symbol))} ${a.op === "above" ? "≥" : "≤"} ${mkPrice(a.value)}</b>
        <span>${a.fired_at ? t("Tocou {w}", { w: fmt.ago(a.fired_at) }) : dist == null ? esc(a.note || t("a vigiar")) : t("a {p} do preço atual", { p: mkPct(dist) })}</span></div>
        <button class="tool" data-alert-del="${a.id}" title="${t("Apagar")}">${icon("x")}</button></div>`;
    }).join("")}</div>`
      : `<p class="faint mk-none">${t("Toca no sino de um dos quatro para seres avisado aqui e no telemóvel quando o preço lá chegar.")}</p>`);
}

/* ================================================================ the news, as cards */
async function mkLoadFeed(refresh = false) {
  if (!$("mk-today") && !$("mk-feed")) return;
  const d = await api("/api/trading/feed").catch((e) => ({ source: "error", error: e.message, items: [] }));
  if (refresh && d.source !== "live") return; // keep what is on screen when a refresh fails
  const before = MK.feed?.items?.map((x) => x.id).join() || "";
  MK.feed = d;
  if (refresh && before === d.items.map((x) => x.id).join()) return; // nothing new: leave the photos where they are
  mkLive(d.fetched_at);
  mkPaintFeed();
}

const mkTopicOf = (x) => x.topics.find((k) => k !== "usd") || x.topics[0] || "usd";
const mkTags = (topics) => topics.map((k) => `<span class="mk-tag t-${k}">${esc(t(MK_TOPIC[k]))}</span>`).join("");

// Free photos of each market (Wikimedia Commons, assets/mercados), for the stories that bring none of their own (most
// of Reuters'). [file, author, licence]: a CC BY licence wants the author named under the photo.
const MK_PHOTOS = {
  gold: [["gold-1", "Stevebidmead", "CC0"], ["gold-2", "Ank Kumar", "CC BY-SA 4.0"]],
  eurusd: [["eurusd-1", "Avij", "Domínio público"], ["eurusd-2", "DiscoA340", "CC0"], ["eurusd-3", "DXR", "CC BY-SA 4.0"]],
  ger40: [["ger40-1", "Schlurcher", "CC BY 4.0"], ["ger40-2", "Jörg Braukmann", "CC BY-SA 4.0"]],
  gbpusd: [["gbpusd-1", "VirtuallyLondonBecky", "CC BY-SA 4.0"], ["gbpusd-2", "M R Karim Reza", "CC BY-SA 4.0"], ["gbpusd-3", "Diliff", "CC BY-SA 3.0"]],
  usd: [["usd-1", "Federal Reserve", "Domínio público"], ["usd-2", "Hamster28", "Domínio público"], ["usd-3", "Billie Grace Ward", "CC0"]],
};

// the picture of a card: the story's own photo, or one of its market's (the same story always gets the same one)
function mkArt(x, cls = "") {
  const list = MK_PHOTOS[mkTopicOf(x)] || MK_PHOTOS.usd;
  let h = 0;
  for (const c of x.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [file, by, lic] = list[h % list.length];
  const credit = /^CC BY/.test(lic) ? `<small class="mk-credit" ${x.image ? "hidden" : ""}>${t("Foto")}: ${esc(by)} · ${esc(lic)} · Wikimedia Commons</small>` : "";
  const own = x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.querySelector('.mk-credit')?.removeAttribute('hidden'); this.remove()">` : "";
  return `<div class="mk-nc-img ${cls}"><img src="assets/mercados/${file}.jpg" alt="" loading="lazy">${own}${credit}</div>`;
}

function mkCard(x) {
  const fresh = Date.now() / 1000 - x.ts < 3600;
  const text = x.bullets?.length ? `<ul>${x.bullets.slice(0, 2).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : x.lead ? `<p>${esc(x.lead)}</p>` : "";
  return `<article class="mk-nc" data-news="${esc(x.id)}" tabindex="0">${mkArt(x)}
    <div class="mk-nc-b"><div class="mk-nc-t">${mkTags(x.topics)}${fresh ? `<span class="mk-new"><i class="mk-dot live"></i>${t("nova")}</span>` : ""}</div>
      <h3>${esc(x.title)}</h3>${text}
      <footer>${esc(x.source)} · ${fmt.ago(x.at)}${x.read_min ? ` · ${t("{n} min de leitura", { n: x.read_min })}` : ""}</footer></div></article>`;
}

function mkPaintFeed() {
  const d = MK.feed;
  if (!d) return;
  const today = $("mk-today");
  if (today) {
    const grid = today.querySelector(".mk-grid");
    grid.innerHTML = d.source !== "live" ? ui.error(d.error) : d.items.length ? d.items.slice(0, 6).map(mkCard).join("") : mkNone("Sem notícias dos nossos quatro agora.");
  }
  const el = $("mk-feed");
  if (!el) return;
  const topics = $("mk-topics");
  const count = (k) => (k === "all" ? d.items.length : d.items.filter((x) => mkShows(x, k)).length);
  if (topics) topics.innerHTML = [["all", "Tudo"]].concat(MK_FOCUS.map(([k, , code]) => [k, code]))
    .map(([k, l]) => `<button class="${MK.topic === k ? "on" : ""}" data-topic="${k}">${k === "all" ? "" : mkFlags(k, "sm")}${esc(t(l))}<i>${count(k)}</i></button>`).join("");
  if (d.source !== "live") { el.innerHTML = ui.error(d.error); return; }
  const items = d.items.filter((x) => mkShows(x, MK.topic));
  if (!items.length) { el.innerHTML = ui.empty("news", "Sem notícias aqui agora", "Nos últimos cinco dias não houve nada em português sobre isto."); return; }
  const groups = [];
  items.forEach((x) => {
    const key = fmt.day(x.at);
    const g = groups[groups.length - 1];
    if (g && g.key === key) g.items.push(x); else groups.push({ key, items: [x] });
  });
  el.innerHTML = groups.map((g) => `<div class="mk-day"><h4>${esc(g.key)}<i>${g.items.length}</i></h4><div class="mk-grid">${g.items.map(mkCard).join("")}</div></div>`).join("");
}

// the dollar is the other half of gold, EUR/USD and GBP/USD: its news count for the three
const mkShows = (x, k) => k === "all" || x.topics.includes(k) || (k !== "ger40" && x.topics.includes("usd"));

async function mkReader(x) {
  const k = mkTopicOf(x), sym = (MK_FOCUS.find(([id]) => id === k) || [])[1] || "";
  const names = x.topics.map((tp) => MK_TOPIC[tp]).join(", ");
  openModal(`<article class="mk-rd">${mkArt(x, "wide")}
    <div class="mk-nc-t">${mkTags(x.topics)}</div>
    <h2>${esc(x.title)}</h2>
    <p class="mk-rd-m">${esc(x.source)} · ${esc(fmt.day(x.at))} ${t("às")} ${fmt.hhmm(x.at)}${x.read_min ? ` · ${t("{n} min de leitura", { n: x.read_min })}` : ""}</p>
    <div class="mk-rd-a"><button type="button" class="btn primary" id="mk-rd-explain">${icon("spark")}${t("Explica-me isto")}</button>
      ${x.url ? `<a class="btn" href="${esc(x.url)}" target="_blank" rel="noopener">${t("Abrir no site")} ↗</a>` : ""}</div>
    <div class="mk-rd-ask" id="mk-rd-ask"></div>
    ${x.bullets?.length ? `<div class="mk-rd-pts"><b>${t("Em resumo")}</b><ul>${x.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>` : ""}
    <div class="mk-rd-text" id="mk-rd-text">${x.story ? ui.skeleton(5) : `<p class="faint">${t("O texto completo está no site da {s}.", { s: esc(x.source) })}</p>`}</div>
    <div class="form-foot"><button type="button" class="btn quiet" data-close>${t("Fechar")}</button></div></article>`);
  $("modal-box").classList.add("wide");
  $("mk-rd-explain").onclick = (e) => {
    e.currentTarget.disabled = true;
    const gist = x.bullets?.length ? x.bullets.join(" ") : x.lead || "";
    mkAskRun(`Explica-me em linguagem simples, em 4 ou 5 frases, esta notícia e o que pode significar para ${names}. Notícia: «${x.title}». ${gist}`.slice(0, 1900), sym, $("mk-rd-ask"));
  };
  if (!x.story) return;
  const s = await api(`/api/trading/story?id=${encodeURIComponent(x.id)}`).catch((e) => ({ source: "error", error: e.message }));
  const el = $("mk-rd-text");
  if (!el) return;
  el.innerHTML = s.source === "live" && s.paragraphs?.length ? s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")
    : `<p class="faint">${t("Não deu para trazer o texto agora.")} ${x.url ? t("Abre no site.") : ""}</p>`;
}

/* ================================================================ the week's diary */
async function mkLoadCal() {
  if (!$("mk-cal")) return;
  const d = await api("/api/trading/calendar").catch((e) => ({ source: "error", error: e.message, events: [] }));
  MK.cal = d;
  mkPaintCal();
}

function mkPaintCal() {
  const el = $("mk-cal"), d = MK.cal;
  if (!el || !d) return;
  const full = MK.tab === "noticias";
  const now = Date.now() / 1000;
  const next = d.events.find((e) => e.ts > now - 600);
  const shown = full ? d.events : d.events.filter((e) => e.ts > now - 3600).slice(0, 7);
  const head = mkHead(full ? "Agenda da semana" : "Agenda", t("dólar, euro e libra"));
  if (d.source !== "live") { el.innerHTML = head + mkNone(d.error || "Sem agenda agora."); return; }
  if (!shown.length) { el.innerHTML = head + mkNone("Esta semana já não há mais nada importante. A agenda da próxima semana chega no domingo."); return; }
  const groups = [];
  shown.forEach((e) => {
    const key = fmt.day(e.at);
    const g = groups[groups.length - 1];
    if (g && g.key === key) g.items.push(e); else groups.push({ key, items: [e] });
  });
  const soon = (e) => {
    const min = Math.round((e.ts - now) / 60);
    return min > 0 && min < 180 ? `<em>${min < 60 ? t("daqui a {n} min", { n: min }) : t("daqui a {n} h", { n: Math.round(min / 60) })}</em>` : "";
  };
  el.innerHTML = head + groups.map((g) => `<div class="mk-cal-d"><h4>${esc(g.key)}</h4>${g.items.map((e) => `<div class="mk-ev ${e.ts < now - 600 ? "past" : ""} ${e === next ? "next" : ""}" title="${esc(e.title_en)}">
      <time>${fmt.hhmm(e.at)}</time>${mkFlags(e.currency, "sm")}<div><b><i class="mk-imp ${e.impact}" title="${esc(t(e.impact === "high" ? "Impacto alto" : "Impacto médio"))}"></i>${esc(e.title)}</b>
      <span>${[e.actual ? `${t("Saiu")} <b>${esc(e.actual)}</b>` : "", e.forecast ? `${t("Previsto")} ${esc(e.forecast)}` : "", e.previous ? `${t("Anterior")} ${esc(e.previous)}` : ""].filter(Boolean).join(" · ") || esc(e.currency)}${soon(e)}</span></div></div>`).join("")}</div>`).join("")
    + `<p class="mk-foot"><i class="mk-imp high"></i>${t("impacto alto")} <i class="mk-imp medium"></i>${t("impacto médio")} · ${t("o que pode mexer o mercado · ForexFactory")}</p>`;
}

/* ================================================================ Notícias */
MK_VIEWS.noticias = async (body) => {
  body.innerHTML = `<div class="mk-news-top"><div class="segx mk-topics" id="mk-topics"></div>
      <span class="faint">${t("Em português · Reuters e Investing.com · toca numa notícia para a ler")}</span></div>
    <div class="mk-news-cols"><section class="mk-feed" id="mk-feed"><div class="mk-grid">${ui.skeleton(8)}</div></section>
      <aside class="panel mk-card mk-cal-side" id="mk-cal">${ui.skeleton(8)}</aside></div>`;
  if (MK.feed) mkPaintFeed();
  mkLoadCal();
  await mkLoadFeed();
};

/* ================================================================ Gráfico */
MK_VIEWS.grafico = async (body) => {
  const sym = MK.symbol;
  const focus = MK_FOCUS.find(([, s]) => s === sym);
  body.innerHTML = `<div class="mk-symbar">${MK_FOCUS.map(([k, s, code]) => `<a class="mk-sp ${s === sym ? "on" : ""}" href="${mkGo(s)}">${mkFlags(k, "sm")}${esc(code)}</a>`).join("")}
      <button class="mk-sp quiet" data-sym-pick>${icon("search")}${t("Outro símbolo")}</button></div>
    <section class="panel mk-sym" id="mk-sym">${ui.skeleton(2)}</section>
    <div class="mk-chart-row"><div class="panel mk-chart" id="mk-chart"></div><aside class="panel mk-tech" id="mk-tech">${ui.skeleton(8)}</aside></div>
    <div class="mk-below" id="mk-below"><section class="panel mk-card" id="mk-sym-news">${ui.skeleton(5)}</section>${focus ? "" : `<section class="panel mk-card" id="mk-sym-ins" hidden></section>`}</div>
    <section class="panel mk-fin" id="mk-fin" hidden></section>`;
  mkTv($("mk-chart"), "advanced-chart", { autosize: true, symbol: sym, interval: "60", timezone: MK_TZ, theme: "dark", style: "1",
    backgroundColor: "rgba(14, 16, 19, 1)", gridColor: "rgba(255, 255, 255, 0.04)", allow_symbol_change: false, withdateranges: true,
    hide_side_toolbar: false, details: false, calendar: false, studies: ["STD;RSI"], support_host: "https://www.tradingview.com" });
  await mkLoadSymbol();
  mkSymbolNews(sym, focus);
};

async function mkLoadSymbol(refresh = false) {
  const sym = MK.symbol;
  const d = await api(`/api/trading/symbol?symbol=${encodeURIComponent(sym)}`).catch((e) => ({ missing: true, error: e.message }));
  if (MK.symbol !== sym || !$("mk-sym")) return;
  MK.detail = d;
  mkLive();
  mkPaintSymbolHead();
  if (d.missing) {
    $("mk-tech").innerHTML = ui.empty("alert", "O TradingView não deu dados deste símbolo", d.error || "Pode ser um símbolo sem dados públicos.");
    return;
  }
  paint($("mk-tech"), mkTechPanel(d));
  if (!refresh && (d.type === "stock" || d.type === "dr")) { // a company: who inside it buys and sells, and its accounts
    mkSymbolInsiders(sym);
    const fin = $("mk-fin");
    fin.hidden = false;
    fin.innerHTML = `${mkHead("Dados financeiros", t("TradingView"))}<div class="mk-fin-w" id="mk-fin-w"></div>`;
    mkTv($("mk-fin-w"), "financials", { symbol: sym, displayMode: "regular", width: "100%", height: "100%", largeChartUrl: "" });
  }
}

function mkPaintSymbolHead() {
  const el = $("mk-sym"), d = MK.detail;
  if (!el || !d) return;
  const sym = MK.symbol, focus = MK_FOCUS.find(([, s]) => s === sym);
  const name = focus ? focus[2] : d.name || MK.names?.[sym] || sym;
  const sub = focus ? t(focus[3]) : d.full_name || sym;
  el.innerHTML = `<div class="mk-sym-l">${focus ? mkFlags(focus[0], "lg") : mkLogo(d, "xl")}<div><div class="ph-eyebrow">${esc([d.exchange || sym.split(":")[0], d.currency].filter(Boolean).join(" · "))}</div>
      <h2>${esc(name)}</h2><span class="faint">${esc(sub)}</span></div></div>
    <div class="mk-sym-p">${d.missing ? `<b class="mk-big">—</b>` : `<b class="mk-big mono ${mkFlashClass(d)}">${mkQuote({ ...d, code: name })}<small>${esc(d.currency)}</small></b>
      <span class="mk-chg ${mkTone(d.change_pct)}">${d.change == null ? "" : (d.change > 0 ? "+" : d.change < 0 ? "−" : "") + mkPrice(Math.abs(d.change))} (${mkPct(d.change_pct)})</span>`}</div>
    <div class="mk-sym-a">
      <button class="btn" data-alert="${esc(sym)}" data-name="${esc(name)}" data-price="${d.price ?? ""}">${icon("bell")}${t("Alerta")}</button>
      <button class="btn ok" data-trade="${esc(sym)}" data-name="${esc(name)}" data-side="buy">${t("Comprar")}</button>
      <button class="btn danger" data-trade="${esc(sym)}" data-name="${esc(name)}" data-side="sell">${t("Vender")}</button>
      <button class="btn primary" data-ask="${esc(sym)}">${icon("spark")}${t("Análise do Claude")}</button></div>`;
  if (d.price != null) MK.last[sym] = d.price;
}

// a gauge from -1 (sell) to 1 (buy), the way TradingView draws its technical rating
function mkGauge(value, title, rate) {
  const r = 38, cx = 50, cy = 50, seg = 5, gap = 0.035;
  const pt = (a) => [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  const tones = ["down2", "down", "flat", "up", "up2"];
  let arcs = "";
  for (let i = 0; i < seg; i++) {
    const a0 = Math.PI - (Math.PI / seg) * i - (i ? gap : 0), a1 = Math.PI - (Math.PI / seg) * (i + 1) + (i < seg - 1 ? gap : 0);
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
    arcs += `<path class="g-${tones[i]}" d="M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}"/>`;
  }
  const v = Math.max(-1, Math.min(1, value ?? 0)), a = Math.PI * (1 - (v + 1) / 2), [nx, ny] = [cx + (r - 9) * Math.cos(a), cy - (r - 9) * Math.sin(a)];
  return `<div class="mk-gauge"><svg viewBox="0 0 100 56" role="img" aria-label="${esc(t(title))}: ${esc(rate ? t(MK_RATE[rate][0]) : "—")}">${arcs}
    ${value == null ? "" : `<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(2)}" y2="${ny.toFixed(2)}"/><circle cx="${cx}" cy="${cy}" r="3.2"/>`}</svg>
    <span>${t(title)}</span>${mkRate(rate)}</div>`;
}

// what a trader reads at a glance: the signal on four time frames, how far it moved, and the month's levels
function mkTechPanel(d) {
  const f = d.fundamentals, r = d.ratings;
  const hi = f.hi52, lo = f.lo52, pos = hi != null && lo != null && hi > lo ? Math.max(0, Math.min(100, (d.price - lo) / (hi - lo) * 100)) : null;
  const stat = (label, value) => (value == null || value === "—" ? "" : `<div><span>${t(label)}</span><b>${value}</b></div>`);
  const company = d.type === "stock" || d.type === "dr";
  return `${mkHead("Sinal técnico", t("TradingView"))}
    <div class="mk-gauges one">${mkGauge(r.values.all, "Resumo do dia", r.all)}</div>
    <div class="mk-tf">${[["1 h", r.h1], ["4 h", r.h4], ["1 dia", r.all], ["1 semana", r.w1]].map(([l, v]) => `<div><span>${t(l)}</span>${mkRate(v)}</div>`).join("")}</div>
    <p class="mk-foot mk-tf-note">${t("O resumo dos indicadores técnicos do TradingView. Ajuda a ler o momento, não é uma recomendação.")}</p>
    <div class="mk-perf">${Object.entries(d.perf).map(([k, v]) => `<div class="${mkTone(v)}"><span>${k}</span><b>${mkPct(v)}</b></div>`).join("")}</div>
    ${pos == null ? "" : `<div class="mk-52"><span>${t("52 semanas")}</span><div class="mk-range wide"><i style="left:${pos}%"></i><small>${mkPrice(lo)}</small><small>${mkPrice(hi)}</small></div></div>`}
    ${mkPivots(d)}
    <div class="mk-stats">${stat("Volatilidade (dia)", d.volatility == null ? null : mkFx(d.volatility, 2) + "%")}${stat("ATR (14)", d.atr == null ? null : mkPrice(d.atr))}
      ${company ? `${stat("Capitalização", f.mcap == null ? null : mkBig(f.mcap, true))}${stat("P/L", f.pe == null ? null : mkFx(f.pe, 1))}
      ${stat("Dividendo", f.dividend == null ? null : mkFx(f.dividend, 2) + "%")}${stat("Próximos resultados", f.earnings ? fmt.date(f.earnings) : null)}` : ""}</div>`;
}

function mkPivots(d) {
  const p = d.pivots, rows = [["R3", p.R3], ["R2", p.R2], ["R1", p.R1], ["P", p.Middle], ["S1", p.S1], ["S2", p.S2], ["S3", p.S3]].filter(([, v]) => v != null);
  if (!rows.length) return "";
  const vals = rows.map(([, v]) => v).concat(d.price), hi = Math.max(...vals), lo = Math.min(...vals), y = (v) => (hi === lo ? 50 : (hi - v) / (hi - lo) * 100);
  return `<div class="mk-pivots"><div class="mk-sec">${t("Níveis do mês")}</div>
    <div class="mk-piv">${rows.map(([k, v]) => `<div class="mk-piv-r ${k[0] === "R" ? "res" : k[0] === "S" ? "sup" : "mid"}" style="top:${y(v)}%"><span>${k}</span><i></i><b class="mono">${mkPrice(v)}</b></div>`).join("")}
      <div class="mk-piv-now" style="top:${y(d.price)}%"><span>${t("agora")}</span><i></i><b class="mono">${mkPrice(d.price)}</b></div></div>
    <p class="mk-foot">${t("R = resistências, S = suportes, P = pivot do mês. Os traders vigiam estes níveis.")}</p></div>`;
}

async function mkSymbolInsiders(sym) {
  let el = $("mk-sym-ins");
  if (!el) return;
  const d = await api(`/api/trading/insiders?symbol=${encodeURIComponent(sym)}`).catch((e) => ({ source: "error", error: e.message, items: [] }));
  el = $("mk-sym-ins");
  if (!el || MK.symbol !== sym) return;
  el.hidden = false;
  $("mk-below").classList.add("mk-2");
  const buys = d.items.filter((x) => x.kind === "buy"), sells = d.items.filter((x) => x.kind === "sell");
  const sum = (l) => l.reduce((s, x) => s + (x.value || 0), 0);
  el.innerHTML = mkHead("Insiders desta empresa", d.source === "live" ? t("SEC · Form 4") : "")
    + (d.source !== "live" ? mkNone(d.reason || d.error || "Sem dados.")
      : !d.items.length ? mkNone("Sem compras nem vendas de insiders nos últimos registos.")
        : `<div class="mk-ins-sum"><div><span>${t("Comprado")}</span><b class="up">${mkBig(sum(buys), true)}</b><small>${t("{n} compras", { n: buys.length })}</small></div>
          <div><span>${t("Vendido")}</span><b class="down">${mkBig(sum(sells), true)}</b><small>${t("{n} vendas", { n: sells.length })}</small></div></div>
          <table class="tbl mk-tbl"><thead><tr><th>${t("Data")}</th><th>${t("Quem")}</th><th>${t("O quê")}</th><th class="r">${t("Ações")}</th><th class="r">${t("Valor")}</th></tr></thead>
          <tbody>${d.items.slice(0, 14).map((x) => `<tr><td class="mono faint">${esc(x.date)}</td><td><b>${esc(x.owner)}</b><small class="mk-sub">${esc(x.role)}</small></td>
            <td>${mkKind(x.kind)}</td><td class="r mono">${x.shares == null ? "—" : mkBig(x.shares)}</td><td class="r mono">${x.value == null ? "—" : mkBig(x.value, true)}</td></tr>`).join("")}</tbody></table>`);
}

const MK_KIND = { buy: ["Compra", "up"], sell: ["Venda", "down"], award: ["Atribuição", "flat"], exercise: ["Exercício de opções", "flat"],
  tax: ["Retenção p/ impostos", "flat"], gift: ["Doação", "flat"], disposal: ["Alienação", "flat"], conversion: ["Conversão", "flat"], other: ["Outro", "flat"] };
const mkKind = (k) => `<span class="mk-rate ${(MK_KIND[k] || MK_KIND.other)[1]}">${t((MK_KIND[k] || MK_KIND.other)[0])}</span>`;

// one of our four: its cards from the Portuguese feed; any other symbol: TradingView's own headlines for it
async function mkSymbolNews(sym, focus) {
  if (focus) {
    const d = MK.feed?.source === "live" ? MK.feed : await api("/api/trading/feed").catch(() => null);
    if (d?.source === "live") MK.feed = d;
    const el = $("mk-sym-news");
    if (!el || MK.symbol !== sym) return;
    const items = (d?.items || []).filter((x) => mkShows(x, focus[0])).slice(0, 6);
    el.innerHTML = mkHead(t("Notícias de {s}", { s: focus[2] }), `<a href="#/mercados/noticias" data-topic="${focus[0]}">${t("Ver todas")} →</a>`)
      + (items.length ? `<div class="mk-grid">${items.map(mkCard).join("")}</div>` : mkNone("Sem notícias em português nos últimos dias."));
    return;
  }
  const d = await api(`/api/trading/news?symbol=${encodeURIComponent(sym)}`).catch(() => null);
  const el = $("mk-sym-news");
  if (!el || MK.symbol !== sym) return;
  el.innerHTML = mkHead("Notícias deste símbolo", t("TradingView · em inglês"))
    + (d?.items?.length ? `<div class="mk-fl">${d.items.slice(0, 12).map((x) => `<div class="mk-n"><time>${fmt.hhmm(x.at)}</time><div>
      <a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a><span class="mk-n-m">${esc(x.source)} · ${fmt.ago(x.at)}</span></div></div>`).join("")}</div>`
      : mkNone("Sem notícias recentes deste símbolo."));
}

/* ================================================================ Insiders */
const MK_INS = [["buys", "Compras"], ["clusters", "Compras em grupo"], ["top", "Maiores da semana"], ["sales", "Vendas"]];

MK_VIEWS.insiders = async (body) => {
  body.innerHTML = `<div class="mk-ins-top"><div class="segx" id="mk-ins-seg"></div>
      <form id="mk-ins-f" class="mk-ins-f"><input placeholder="${esc(t("Histórico de uma empresa dos EUA: AAPL, NVDA…"))}" maxlength="10" spellcheck="false"><button class="btn">${icon("search")}${t("Ver")}</button></form></div>
    <p class="mk-lead">${t("Os administradores e os grandes acionistas têm de declarar à SEC cada compra e venda de ações da própria empresa, em dois dias. Compras com o próprio dinheiro, sobretudo de vários ao mesmo tempo, são dos sinais que os profissionais mais seguem.")}</p>
    <div class="bd-kpis mk-kpis" id="mk-ins-k"></div>
    <section class="panel mk-card" id="mk-ins">${ui.skeleton(10)}</section>`;
  await mkLoadInsiders();
};

async function mkLoadInsiders() {
  const seg = $("mk-ins-seg");
  if (!seg) return;
  seg.innerHTML = MK_INS.map(([id, l]) => `<button class="${id === MK.ins ? "on" : ""}" data-ins-view="${id}">${t(l)}</button>`).join("");
  const view = MK.ins;
  let el = $("mk-ins");
  el.innerHTML = ui.skeleton(10);
  const d = await api(`/api/trading/insiders?view=${view}`).catch((e) => ({ source: "error", error: e.message, items: [] }));
  el = $("mk-ins");
  if (MK.ins !== view || !el) return;
  if (d.source !== "live") { el.innerHTML = ui.error(d.error); $("mk-ins-k").innerHTML = ""; return; }
  const items = d.items, total = items.reduce((s, x) => s + (x.value || 0), 0), big = items.reduce((m, x) => ((x.value || 0) > (m?.value || 0) ? x : m), null);
  const kpi = (l, v, sub = "") => `<div class="panel bd-kpi"><span class="bd-l">${t(l)}</span>${ui.num(v)}${sub ? `<small class="faint">${sub}</small>` : ""}</div>`;
  $("mk-ins-k").innerHTML = kpi(view === "sales" ? "Valor vendido" : "Valor comprado", mkBig(total, true), t("nesta lista"))
    + kpi("Empresas", String(new Set(items.map((x) => x.ticker)).size)) + kpi("Maior operação", big ? mkBig(big.value, true) : null, big ? esc(big.ticker + " · " + big.owner) : "")
    + kpi("Última entrega", items[0] ? esc(items[0].filed.slice(11, 16) || items[0].filed) : null, items[0] ? esc(items[0].filed.slice(0, 10)) : "");
  const cluster = view === "clusters";
  el.innerHTML = mkHead(MK_INS.find(([id]) => id === view)[1], `${esc(d.via)} · ${t("atualizado {h}", { h: fmt.hhmm(d.fetched_at) })}`)
    + `<div class="mk-scroll"><table class="tbl mk-tbl mk-ins-t"><thead><tr><th>${t("Entregue")}</th><th>${t("Negócio")}</th><th>${t("Ticker")}</th><th>${t("Empresa")}</th>
      <th>${cluster ? t("Insiders") : t("Quem")}</th><th class="r">${t("Preço")}</th><th class="r">${t("Ações")}</th><th class="r">${t("Posição")}</th><th class="r">${t("Valor")}</th></tr></thead>
      <tbody>${items.map((x) => `<tr ${x.symbol ? `data-sym="${esc(x.symbol)}" data-name="${esc(x.company)}" class="go"` : ""}>
        <td class="mono faint">${esc(x.filed.slice(0, 16))}</td><td class="mono faint">${esc(x.date)}</td><td><b>${esc(x.ticker)}</b></td><td class="ell mk-co">${esc(x.company)}</td>
        <td>${cluster ? `<b>${x.insiders ?? "?"}</b> <small class="mk-sub">${esc(x.industry)}</small>` : `<b>${esc(x.owner)}</b><small class="mk-sub">${esc(x.role)}</small>`}</td>
        <td class="r mono">${x.price == null ? "—" : "$" + mkPrice(x.price)}</td><td class="r mono">${x.shares == null ? "—" : mkBig(x.shares)}</td>
        <td class="r mono ${x.new ? "up" : mkTone(x.change_pct)}">${x.new ? t("Nova") : x.change_pct == null ? "—" : mkPct(x.change_pct)}</td>
        <td class="r mono ${x.kind === "buy" ? "up" : x.kind === "sell" ? "down" : ""}"><b>${x.value == null ? "—" : mkBig(x.value, true)}</b></td></tr>`).join("")}</tbody></table></div>`;
}

async function mkInsiderCompany(ticker) {
  if (!ticker) return;
  const tk = ticker.toUpperCase().replace(/^[A-Z]+:/, "");
  const known = await api(`/api/markets/tv?q=${encodeURIComponent(tk)}`).catch(() => []);
  const hit = known.find((x) => x.symbol === tk && ["NASDAQ", "NYSE", "AMEX", "CBOE", "OTC"].includes(x.exchange)) || known.find((x) => ["NASDAQ", "NYSE", "AMEX"].includes(x.exchange));
  const sym = hit ? hit.id : `NASDAQ:${tk}`;
  mkSetSymbol(sym, hit?.name || tk);
  location.hash = mkGo(sym);
}

/* ================================================================ Investidores */
MK_VIEWS.investidores = async (body, cik) => {
  if (cik) return mkInvestor(body, cik);
  body.innerHTML = `<p class="mk-lead">${t("Quem gere mais de 100 milhões de dólares em ações dos EUA entrega à SEC, a cada trimestre, a lista de tudo o que tem (o 13F). Segue um investidor e o Hub avisa-te quando ele entregar algo novo.")}</p>
    <div class="mk-inv-grid" id="mk-inv">${ui.skeleton(6)}</div>`;
  const list = await api("/api/trading/investors").catch(() => []);
  const el = $("mk-inv");
  if (!el) return;
  el.innerHTML = list.map((x) => `<article class="panel hover mk-inv" data-inv="${esc(x.cik)}">
      <div class="mk-inv-av">${esc((x.person || x.firm).split(" ").map((w) => w[0]).slice(0, 2).join(""))}</div>
      <div class="mk-inv-t"><h3>${esc(x.person || x.firm)}</h3><span>${esc(x.person ? x.firm : "")}</span><small class="mono faint">CIK ${esc(x.cik)}</small></div>
      <button class="btn sm ${x.item_id ? "ok" : ""}" data-follow="${esc(x.cik)}" data-name="${esc(x.person || x.firm)}" data-item="${x.item_id || ""}">${icon(x.item_id ? "tick" : "bell")}${t(x.item_id ? "A seguir" : "Seguir")}</button>
    </article>`).join("");
};

async function mkFollow(cik, name, itemId) {
  try {
    if (itemId) await api(`/api/trading/items/${itemId}`, { method: "DELETE" });
    else { await api("/api/trading/items", { method: "POST", body: { kind: "investor", symbol: cik, name } }); flash(t("A seguir {n}: o Hub avisa quando entregar algo novo à SEC", { n: name })); }
  } catch (e) { flash(e.message); }
  const body = $("mk-body");
  if (body) MK_VIEWS.investidores(body, MK.tab === "investidores" && location.hash.split("/")[3] ? location.hash.split("/")[3] : "");
}

const MK_CHANGE = { new: ["Novo", "up2"], added: ["Reforçou", "up"], reduced: ["Reduziu", "down"], same: ["Igual", "flat"], sold: ["Vendeu tudo", "down2"] };

function mkQuarter(period) {
  if (!period) return "—";
  const [y, m] = period.split("-").map(Number);
  return t("{q}.º trimestre de {y}", { q: Math.ceil(m / 3), y });
}

async function mkInvestor(body, cik) {
  body.innerHTML = `<p style="margin:0 0 12px"><a class="dim" href="#/mercados/investidores">← ${t("Investidores")}</a></p><div id="mk-invd">${ui.skeleton(10)}</div>`;
  const [d, list] = await Promise.all([api(`/api/trading/investors/${cik}`).catch((e) => ({ source: "error", error: e.message })), api("/api/trading/investors").catch(() => [])]);
  const el = $("mk-invd");
  if (!el) return;
  if (d.source !== "live") { el.innerHTML = ui.error(d.reason || d.error); return; }
  const who = list.find((x) => x.cik === String(cik)) || {};
  const top = d.holdings[0]?.weight || 1;
  const moves = d.holdings.filter((x) => x.change === "new" || x.change === "added" || x.change === "reduced");
  const kpi = (l, v, sub = "") => `<div class="panel bd-kpi"><span class="bd-l">${t(l)}</span>${ui.num(v)}${sub ? `<small class="faint">${sub}</small>` : ""}</div>`;
  const row = (x, i) => `<tr ${x.symbol ? `data-sym="${esc(x.symbol)}" data-name="${esc(x.name)}" class="go"` : ""}><td class="faint mono">${i + 1}</td>
    <td><b>${esc(x.ticker || "—")}</b></td><td class="ell mk-co">${esc(x.name)}<small class="mk-sub">${esc(x.cls)}${x.put_call ? " · " + esc(x.put_call) : ""}</small></td>
    <td class="mk-w"><i style="width:${(x.weight / top * 100).toFixed(1)}%"></i><span class="mono">${mkFx(x.weight, 1)}%</span></td>
    <td class="r mono">${mkBig(x.value, true)}</td><td class="r mono">${mkBig(x.shares)}</td>
    <td class="r">${x.change ? `<span class="mk-rate ${MK_CHANGE[x.change][1]}">${t(MK_CHANGE[x.change][0])}${x.change_pct != null && x.change !== "same" ? " " + mkPct(x.change_pct) : ""}</span>` : ""}</td></tr>`;
  el.innerHTML = `<header class="mk-invh"><div class="mk-inv-av xl">${esc((who.person || d.name).split(" ").map((w) => w[0]).slice(0, 2).join(""))}</div>
      <div><div class="ph-eyebrow">${t("13F · {q}", { q: mkQuarter(d.period) })}</div><h2>${esc(who.person || d.name)}</h2><span class="faint">${esc(d.name)}</span></div>
      <div class="mk-invh-a"><button class="btn ${who.item_id ? "ok" : ""}" data-follow="${esc(cik)}" data-name="${esc(who.person || d.name)}" data-item="${who.item_id || ""}">${icon(who.item_id ? "tick" : "bell")}${t(who.item_id ? "A seguir" : "Seguir")}</button>
        <a class="btn" href="${esc(d.url)}" target="_blank" rel="noopener">${t("Ver na SEC")}</a></div></header>
    <div class="bd-kpis mk-kpis">${kpi("Carteira declarada", mkBig(d.total, true))}${kpi("Posições", String(d.count))}
      ${kpi("Posições novas", String(d.new), d.previous ? t("vs {q}", { q: mkQuarter(d.previous) }) : "")}${kpi("Vendeu tudo", String(d.sold.length))}
      ${kpi("Entregue à SEC", fmt.date(d.filed))}</div>
    ${moves.length ? `<section class="panel mk-card">${mkHead("O que mudou no trimestre", t("{n} movimentos", { n: moves.length + d.sold.length }))}<div class="mk-moves">
      ${moves.concat(d.sold).slice(0, 18).map((x) => `<div class="mk-mvt ${MK_CHANGE[x.change][1]}" ${x.symbol ? `data-sym="${esc(x.symbol)}"` : ""}><b>${esc(x.ticker || x.name.split(" ")[0])}</b>
        <span>${t(MK_CHANGE[x.change][0])}${x.change_pct != null ? " " + mkPct(x.change_pct) : ""}</span><small>${mkBig(x.value, true)}</small></div>`).join("")}</div></section>` : ""}
    <section class="panel mk-card">${mkHead("Carteira", t("as maiores {n} posições · peso na carteira", { n: d.holdings.length }))}
      <div class="mk-scroll"><table class="tbl mk-tbl"><thead><tr><th>#</th><th>${t("Ticker")}</th><th>${t("Empresa")}</th><th>${t("Peso")}</th><th class="r">${t("Valor")}</th><th class="r">${t("Ações")}</th><th class="r">${t("Trimestre")}</th></tr></thead>
      <tbody>${d.holdings.map(row).join("")}</tbody></table></div></section>
    <p class="mk-foot">${t("O 13F chega à SEC até 45 dias depois do fim do trimestre: mostra o que o investidor tinha, não o que tem hoje. Só ações dos EUA e opções; sem posições a descoberto.")}</p>`;
}

/* ================================================================ Paper trading */
MK_VIEWS.paper = async (body) => {
  if (!MK.tk.symbol) Object.assign(MK.tk, { symbol: MK.symbol, name: MK.names?.[MK.symbol] || "" });
  body.innerHTML = `<p class="mk-lead">${t("Dinheiro a fingir, preços a sério: cada ordem é feita ao preço do TradingView desse momento, convertido para dólares. Começa com $80 000. A liga é da equipa toda.")}</p>
    <div class="bd-kpis mk-kpis" id="mk-pk">${ui.skeleton(2)}</div>
    <div class="mk-alloc" id="mk-alloc"></div>
    <div class="mk-paper-cols"><form class="panel mk-card mk-ticket" id="mk-tk"></form><section class="panel mk-card" id="mk-pos">${ui.skeleton(6)}</section></div>
    <div class="mk-2"><section class="panel mk-card" id="mk-league">${ui.skeleton(4)}</section><section class="panel mk-card" id="mk-orders">${ui.skeleton(6)}</section></div>`;
  mkPaintTicket();
  mkTicketQuote();
  await mkLoadPaper();
};

async function mkLoadPaper(refresh = false) {
  const d = await api("/api/trading/paper").catch((e) => ({ error: e.message }));
  if (!$("mk-pk")) return;
  if (d.error) { $("mk-pos").innerHTML = ui.error(d.error); return; }
  MK.paper = d;
  const m = d.me;
  mkLive();
  const kpi = (l, v, sub = "", cls = "") => `<div class="panel bd-kpi ${cls}"><span class="bd-l">${t(l)}</span>${ui.num(v)}${sub ? `<small class="faint">${sub}</small>` : ""}</div>`;
  $("mk-pk").innerHTML = kpi("Valor da conta", mkUsd(m.equity), m.stale ? t("há posições sem preço agora") : t("começou com {s}", { s: mkUsd(m.start, 0) }))
    + kpi("Resultado", `<span class="${mkTone(m.pnl)}">${mkSignedUsd(m.pnl)}</span>`, `<span class="${mkTone(m.pnl_pct)}">${mkPct(m.pnl_pct)}</span>`)
    + kpi("Dinheiro livre", mkUsd(m.cash)) + kpi("Investido", mkUsd(m.invested), t("{n} posições", { n: m.positions.length }))
    + kpi("Realizado", `<span class="${mkTone(m.realised)}">${mkSignedUsd(m.realised)}</span>`, t("{n} ordens", { n: m.orders }));
  const total = m.equity || 1;
  $("mk-alloc").innerHTML = `<div class="mk-alloc-bar">${m.positions.map((p) => `<i style="width:${Math.max(0.4, p.value / total * 100)}%" title="${esc(mkTicker(p.symbol))} · ${mkFx(p.value / total * 100, 1)}%"></i>`).join("")}
    <i class="cash" style="width:${Math.max(0, m.cash / total * 100)}%" title="${t("Dinheiro")} · ${mkFx(m.cash / total * 100, 1)}%"></i></div>
    <div class="mk-alloc-k"><span><i></i>${t("Investido {p}", { p: mkFx(m.invested / total * 100, 1) + "%" })}</span><span><i class="cash"></i>${t("Dinheiro {p}", { p: mkFx(m.cash / total * 100, 1) + "%" })}</span></div>`;
  paint($("mk-pos"), mkHead("Posições", t("ao preço de agora")) + (m.positions.length ? `<div class="mk-scroll"><table class="tbl mk-tbl"><thead><tr><th>${t("Símbolo")}</th><th class="r">${t("Quantidade")}</th>
      <th class="r">${t("Preço médio")}</th><th class="r">${t("Agora")}</th><th class="r">${t("Dia")}</th><th class="r">${t("Valor")}</th><th class="r">${t("Resultado")}</th><th></th></tr></thead><tbody>
      ${m.positions.map((p) => `<tr data-sym="${esc(p.symbol)}" data-name="${esc(p.name)}" class="go"><td><div class="mk-cell">${mkLogo(p, "sm")}<div><b>${esc(mkTicker(p.symbol))}</b><small class="mk-sub">${esc(p.name)}</small></div></div></td>
        <td class="r mono">${mkFx(p.qty, p.qty >= 100 ? 2 : 4)}</td><td class="r mono">${mkUsd(p.avg)}</td><td class="r mono">${p.price == null ? "—" : mkUsd(p.price)}</td>
        <td class="r">${mkChg(p)}</td><td class="r mono">${mkUsd(p.value)}</td>
        <td class="r mono ${mkTone(p.pnl)}"><b>${mkSignedUsd(p.pnl)}</b><small class="mk-sub">${mkPct(p.pnl_pct)}</small></td>
        <td class="r"><button class="btn sm danger" data-trade="${esc(p.symbol)}" data-name="${esc(p.name)}" data-side="sell">${t("Vender")}</button></td></tr>`).join("")}</tbody></table></div>`
    : ui.empty("wallet", "Ainda sem posições", "Escolhe um símbolo e faz a primeira compra ao lado.")));
  paint($("mk-league"), mkHead("Liga da equipa", t("quem ganha mais com o mesmo ponto de partida"))
    + `<div class="mk-lg">${d.league.map((x, i) => `<div class="mk-lg-r ${x.user === me.username ? "me" : ""}"><span class="mk-lg-n n${i + 1}">${i + 1}</span>${ui.avatar(x.name, "sm")}
      <div><b>${esc(x.name)}</b><small>${t("{n} ordens", { n: x.orders })} · ${t("{n} posições", { n: x.positions })}${x.best ? ` · ${t("melhor: {s}", { s: esc(mkTicker(x.best)) })}` : ""}</small></div>
      <b class="mono">${mkUsd(x.equity, 0)}</b><span class="mk-chg ${mkTone(x.pnl_pct)}">${mkPct(x.pnl_pct)}</span></div>`).join("")}</div>
      ${d.league.length < 2 ? `<p class="mk-foot">${t("Os outros entram na liga com a primeira ordem.")}</p>` : ""}`);
  paint($("mk-orders"), mkHead("Últimas ordens", `<button class="btn sm quiet" data-paper-reset>${t("Recomeçar a conta")}</button>`)
    + (d.trades.length ? `<div class="mk-or">${d.trades.slice(0, 14).map((x) => x.side === "reset"
      ? `<div class="mk-or-r reset"><span>${fmt.date(x.at)}</span><b>${t("Conta reiniciada com {s}", { s: mkUsd(x.price, 0) })}</b></div>`
      : `<div class="mk-or-r" data-sym="${esc(x.symbol)}"><span>${fmt.date(x.at)} ${fmt.hhmm(x.at)}</span><span class="mk-rate ${x.side === "buy" ? "up" : "down"}">${t(x.side === "buy" ? "Compra" : "Venda")}</span>
        <b>${mkFx(x.qty, x.qty >= 100 ? 2 : 4)} ${esc(mkTicker(x.symbol))}</b><span class="mono">${t("a {p}", { p: mkUsd(x.price) })}</span><b class="mono">${mkUsd(x.qty * x.price)}</b></div>`).join("")}</div>`
      : mkNone("Ainda sem ordens.")));
  if (!refresh) mkTicketSum();
}

function mkPaintTicket() {
  const f = $("mk-tk"), tk = MK.tk;
  if (!f) return;
  const q = tk.quote, buy = tk.side === "buy";
  const held = (MK.paper?.me.positions || []).find((p) => p.symbol === tk.symbol);
  f.innerHTML = `${mkHead("Nova ordem", t("ao preço do TradingView"))}
    <div class="mk-tk-four">${MK_FOCUS.map(([, s, code]) => `<button type="button" class="${s === tk.symbol ? "on" : ""}" data-tk-focus="${s}" data-name="${code}">${code}</button>`).join("")}</div>
    <button type="button" class="mk-tk-sym" data-tk-pick>${q ? mkLogo(q) : `<span class="mk-logo"><b>${esc(mkTicker(tk.symbol)[0] || "?")}</b></span>`}
      <div><b>${esc(mkTicker(tk.symbol) || t("Escolher símbolo"))}</b><span class="ell">${esc(q?.name || tk.name || "")}</span></div>
      <div class="r">${q && !q.missing ? `<b class="mono">${mkPrice(q.price)} <small>${esc(q.currency)}</small></b>${mkChg(q)}` : q?.missing ? `<span class="faint">${t("sem preço")}</span>` : ui.skeleton(1)}</div></button>
    <div class="mk-tk-row"><div class="segx mk-tk-side"><button type="button" class="${buy ? "on buy" : ""}" data-tk-side="buy">${t("Comprar")}</button><button type="button" class="${buy ? "" : "on sell"}" data-tk-side="sell">${t("Vender")}</button></div>
      <div class="segx"><button type="button" class="${tk.mode === "amount" ? "on" : ""}" data-tk-mode="amount">${t("Valor em $")}</button><button type="button" class="${tk.mode === "qty" ? "on" : ""}" data-tk-mode="qty">${t("Quantidade")}</button></div></div>
    <label class="mk-tk-in"><span>${tk.mode === "amount" ? "$" : t("qtd.")}</span><input id="mk-tk-n" type="number" min="0" step="any" placeholder="${tk.mode === "amount" ? "1000" : "10"}" autocomplete="off"></label>
    <div class="mk-tk-quick">${[10, 25, 50, 100].map((p) => `<button type="button" class="chp" data-tk-pct="${p}">${p}%</button>`).join("")}
      <small class="faint">${buy ? t("do dinheiro livre") : held ? t("de {q} que tens", { q: mkFx(held.qty, 4) }) : t("não tens este símbolo")}</small></div>
    <p class="mk-tk-sum" id="mk-tk-sum"></p>
    <button class="btn ${buy ? "ok" : "danger"} mk-tk-go" ${tk.symbol ? "" : "disabled"}>${t(buy ? "Comprar {s}" : "Vender {s}", { s: mkTicker(tk.symbol) })}</button>
    <p class="error" id="mk-tk-err"></p>`;
  mkTicketSum();
}

async function mkTicketQuote() {
  const sym = MK.tk.symbol;
  if (!sym) return;
  const q = await api(`/api/trading/symbol?symbol=${encodeURIComponent(sym)}`).catch(() => ({ missing: true }));
  if (MK.tk.symbol !== sym) return;
  MK.tk.quote = q;
  mkPaintTicket();
}

const mkUsdLike = (c) => ["USD", "USDT", "USDC", "BUSD", "FDUSD", "DAI"].includes(c);

function mkTicketSum() {
  const el = $("mk-tk-sum"), input = $("mk-tk-n");
  if (!el || !input) return;
  const n = Number(input.value), q = MK.tk.quote;
  if (!n || !q || q.missing) { el.innerHTML = ""; return; }
  if (!mkUsdLike(q.currency)) { el.innerHTML = t("Preço em {c}: o Hub converte para dólares ao executar.", { c: esc(q.currency) }); return; }
  el.innerHTML = MK.tk.mode === "amount" ? t("≈ {q} unidades a {p}", { q: mkFx(n / q.price, 4), p: mkUsd(q.price) }) : t("≈ {v} no total", { v: mkUsd(n * q.price) });
}

function mkTicketPct(pct) {
  const tk = MK.tk, m = MK.paper?.me, input = $("mk-tk-n");
  if (!m || !input) return;
  if (tk.side === "buy") { tk.mode = "amount"; mkPaintTicket(); $("mk-tk-n").value = Math.floor(m.cash * pct / 100 * 100) / 100; }
  else {
    const held = m.positions.find((p) => p.symbol === tk.symbol);
    if (!held) return;
    tk.mode = "qty"; mkPaintTicket(); $("mk-tk-n").value = pct === 100 ? held.qty : Math.floor(held.qty * pct / 100 * 1e6) / 1e6;
  }
  mkTicketSum();
}

async function mkOrder() {
  const tk = MK.tk, n = Number($("mk-tk-n")?.value), err = $("mk-tk-err");
  if (!tk.symbol || !n) { err.textContent = t("Diz quanto."); return; }
  const btn = $("mk-tk").querySelector(".mk-tk-go");
  btn.disabled = true;
  err.textContent = "";
  try {
    const r = await api("/api/trading/paper/order", { method: "POST", body: { symbol: tk.symbol, side: tk.side, [tk.mode === "amount" ? "amount" : "qty"]: n } });
    flash(t(tk.side === "buy" ? "Comprado: {q} {s} a {p}" : "Vendido: {q} {s} a {p}", { q: mkFx(r.qty, 4), s: mkTicker(tk.symbol), p: mkUsd(r.price) }));
    $("mk-tk-n").value = "";
    await mkLoadPaper();
    mkPaintTicket();
  } catch (e) { err.textContent = e.message; }
  btn.disabled = false;
}

function mkResetModal() {
  formModal(t("Recomeçar a conta"), `<label class="field" style="grid-column:1/-1"><span>${t("Dinheiro inicial em dólares")}</span><input name="cash" type="number" min="1000" max="10000000" value="80000" required></label>
    <p class="faint" style="grid-column:1/-1;margin:0">${t("As posições fecham e a conta volta a começar. As ordens antigas ficam no histórico.")}</p>`,
  async (v) => { await api("/api/trading/paper/reset", { method: "POST", body: { cash: Number(v.cash) } }); flash(t("Conta reiniciada")); mkLoadPaper(); }, { submit: "Recomeçar" });
}

/* ================================================================ Estratégias: backtests on daily candles */
const mkSma = (a, n) => { const o = Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
function mkEma(a, n) {
  const o = Array(a.length).fill(null), start = a.findIndex((v) => v != null), k = 2 / (n + 1);
  if (start < 0 || a.length - start < n) return o;
  let e = 0;
  for (let i = start; i < start + n; i++) e += a[i];
  e /= n;
  o[start + n - 1] = e;
  for (let i = start + n; i < a.length; i++) { e = a[i] * k + e * (1 - k); o[i] = e; }
  return o;
}
function mkRsi(a, n = 14) {
  const o = Array(a.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i < a.length; i++) {
    const d = a[i] - a[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  }
  return o;
}
const mkClose = (k) => k.map((x) => x[4]);
const mkCross = (f, s) => f.map((v, i) => (v == null || s[i] == null ? null : v > s[i] ? 1 : 0));

const MK_STRATS = {
  sma: { name: "Cruzamento de médias", hint: "Compra quando a média rápida passa acima da lenta e vende quando volta para baixo. Segue a tendência.",
    params: [["fast", "Média rápida", 20], ["slow", "Média lenta", 50]], run: (k, p) => mkCross(mkSma(mkClose(k), p.fast), mkSma(mkClose(k), p.slow)) },
  golden: { name: "Golden cross 50/200", hint: "O clássico dos fundos: dentro quando a média de 50 dias está acima da de 200.",
    params: [], run: (k) => mkCross(mkSma(mkClose(k), 50), mkSma(mkClose(k), 200)) },
  ema: { name: "Cruzamento de EMAs", hint: "Como o das médias, mas com médias exponenciais, mais rápidas a reagir.",
    params: [["fast", "EMA rápida", 9], ["slow", "EMA lenta", 21]], run: (k, p) => mkCross(mkEma(mkClose(k), p.fast), mkEma(mkClose(k), p.slow)) },
  macd: { name: "MACD cruza o sinal", hint: "Dentro quando a linha MACD está acima da linha de sinal (momento a favor).",
    params: [["fast", "Rápida", 12], ["slow", "Lenta", 26], ["sig", "Sinal", 9]],
    run: (k, p) => { const c = mkClose(k), f = mkEma(c, p.fast), s = mkEma(c, p.slow), m = f.map((v, i) => (v == null || s[i] == null ? null : v - s[i])); return mkCross(m, mkEma(m, p.sig)); } },
  rsi: { name: "RSI: sobrevenda e sobrecompra", hint: "Compra quando o RSI cai abaixo do limite de baixo (pânico) e vende quando passa o de cima (euforia).",
    params: [["n", "Período", 14], ["lo", "Compra abaixo de", 30], ["hi", "Vende acima de", 70]],
    run: (k, p) => mkRsi(mkClose(k), p.n).map((v) => (v == null ? null : v < p.lo ? 1 : v > p.hi ? 0 : null)) },
  bollinger: { name: "Bandas de Bollinger", hint: "Regresso à média: compra quando o preço fecha abaixo da banda de baixo e vende quando volta à média.",
    params: [["n", "Período", 20], ["dev", "Desvios", 2]],
    run: (k, p) => {
      const c = mkClose(k), m = mkSma(c, p.n);
      return c.map((v, i) => {
        if (m[i] == null) return null;
        let s = 0;
        for (let j = i - p.n + 1; j <= i; j++) s += (c[j] - m[i]) ** 2;
        const sd = Math.sqrt(s / p.n);
        return v < m[i] - p.dev * sd ? 1 : v > m[i] ? 0 : null;
      });
    } },
  breakout: { name: "Rompimento de máximos", hint: "Tartarugas: compra quando o preço passa o máximo dos últimos N dias e sai quando perde o mínimo dos últimos M.",
    params: [["n", "Entra no máximo de (dias)", 20], ["m", "Sai no mínimo de (dias)", 10]],
    run: (k, p) => k.map((x, i) => {
      if (i < Math.max(p.n, p.m)) return null;
      let hh = -Infinity, ll = Infinity;
      for (let j = i - p.n; j < i; j++) hh = Math.max(hh, k[j][2]);
      for (let j = i - p.m; j < i; j++) ll = Math.min(ll, k[j][3]);
      return x[4] > hh ? 1 : x[4] < ll ? 0 : null;
    }) },
  trend: { name: "Tendência + recuo", hint: "Só compra acima da média de 200 dias, num recuo com RSI abaixo de 40; sai quando o RSI passa 65 ou o preço perde a média de 200.",
    params: [["lo", "RSI de entrada", 40], ["hi", "RSI de saída", 65]],
    run: (k, p) => { const c = mkClose(k), m = mkSma(c, 200), r = mkRsi(c, 14); return c.map((v, i) => (m[i] == null || r[i] == null ? null : v < m[i] ? 0 : r[i] < p.lo ? 1 : r[i] > p.hi ? 0 : null)); } },
};

function mkBacktest(k, strat, params, capital, feePct) {
  const n = k.length, O = k.map((x) => x[1]), C = mkClose(k), fee = feePct / 100;
  const want = strat.run(k, params);
  let cash = capital, qty = 0, entry = null, inDays = 0;
  const eq = [], trades = [];
  const bhQty = capital * (1 - fee) / O[0], bh = C.map((c) => bhQty * c);
  for (let i = 0; i < n; i++) {
    const w = i > 0 ? want[i - 1] : null; // yesterday's signal, done at today's open
    if (w === 1 && !qty) { qty = cash * (1 - fee) / O[i]; entry = { i, price: O[i], cash }; cash = 0; }
    else if (w === 0 && qty) { cash = qty * O[i] * (1 - fee); trades.push({ from: entry.i, to: i, buy: entry.price, sell: O[i], ret: cash / entry.cash - 1 }); qty = 0; entry = null; }
    if (qty) inDays++;
    eq.push(cash + qty * C[i]);
  }
  if (entry) trades.push({ from: entry.i, to: n - 1, buy: entry.price, sell: C[n - 1], ret: eq[n - 1] / entry.cash - 1, open: true });
  const dd = (series) => { let peak = -Infinity, worst = 0; const out = series.map((v) => { peak = Math.max(peak, v); const d = v / peak - 1; worst = Math.min(worst, d); return d * 100; }); return { out, worst: worst * 100 }; };
  const weekend = k.some((x) => [0, 6].includes(new Date(x[0] * 1000).getUTCDay())), perYear = weekend ? 365 : 252;
  const rets = eq.slice(1).map((v, i) => v / eq[i] - 1), mean = rets.reduce((s, x) => s + x, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length || 1));
  const years = (k[n - 1][0] - k[0][0]) / (365.25 * 86400), closed = trades.filter((x) => !x.open);
  const sDD = dd(eq), hDD = dd(bh);
  return { eq, bh, dd: sDD.out, trades, m: {
    ret: (eq[n - 1] / capital - 1) * 100, hold: (bh[n - 1] / capital - 1) * 100, final: eq[n - 1],
    cagr: years > 0.2 ? ((eq[n - 1] / capital) ** (1 / years) - 1) * 100 : null, mdd: sDD.worst, hold_mdd: hDD.worst,
    sharpe: sd ? mean / sd * Math.sqrt(perYear) : null, trades: trades.length, win: closed.length ? closed.filter((x) => x.ret > 0).length / closed.length * 100 : null,
    exposure: inDays / n * 100, best: trades.length ? Math.max(...trades.map((x) => x.ret)) * 100 : null, worst: trades.length ? Math.min(...trades.map((x) => x.ret)) * 100 : null } };
}

MK_VIEWS.estrategias = async (body) => {
  if (!MK.bt.symbol) Object.assign(MK.bt, { symbol: MK.symbol, name: MK.names?.[MK.symbol] || "" });
  body.innerHTML = `<p class="mk-lead">${t("Testa uma estratégia nos preços diários dos últimos anos antes de arriscar: cada sinal é executado na abertura do dia seguinte, com comissão. Compara sempre com comprar e manter.")}</p>
    <form class="panel mk-card mk-bt-f" id="mk-bt-f"></form>
    <div id="mk-bt-out"></div>`;
  mkPaintBtForm();
  await mkRunBt();
};

function mkPaintBtForm() {
  const f = $("mk-bt-f"), bt = MK.bt, s = MK_STRATS[bt.strat];
  if (!f) return;
  f.innerHTML = `<div class="mk-bt-row">
      <button type="button" class="mk-tk-sym sm" data-bt-pick><span class="mk-logo"><b>${esc(mkTicker(bt.symbol)[0] || "?")}</b></span><div><b>${esc(mkTicker(bt.symbol))}</b><span class="ell">${esc(bt.name || bt.symbol)}</span></div></button>
      <label class="field"><span>${t("Estratégia")}</span><select id="mk-bt-s">${Object.entries(MK_STRATS).map(([id, x]) => `<option value="${id}" ${id === bt.strat ? "selected" : ""}>${esc(t(x.name))}</option>`).join("")}</select></label>
      ${s.params.map(([id, label, def]) => `<label class="field sm"><span>${t(label)}</span><input type="number" name="${id}" value="${bt.params[id] ?? def}" min="1" step="any"></label>`).join("")}
      <label class="field sm"><span>${t("Capital $")}</span><input type="number" name="capital" value="${bt.capital}" min="100" step="100"></label>
      <label class="field sm"><span>${t("Comissão %")}</span><input type="number" name="fee" value="${bt.fee}" min="0" max="5" step="0.01"></label>
      <div class="field"><span>${t("Período")}</span><div class="segx">${[["1y", "1 ano"], ["2y", "2 anos"], ["5y", "5 anos"]].map(([v, l]) => `<button type="button" class="${bt.range === v ? "on" : ""}" data-bt-range="${v}">${t(l)}</button>`).join("")}</div></div>
      <div class="mk-bt-go"><button class="btn primary">${icon("play")}${t("Testar")}</button><button type="button" class="btn" data-bt-all>${icon("bolt")}${t("Testar todas")}</button></div></div>
    <p class="mk-foot">${esc(t(s.hint))}</p>`;
  $("mk-bt-s").onchange = (e) => { MK.bt.strat = e.target.value; MK.bt.params = {}; mkPaintBtForm(); };
}

async function mkCandles(symbol, range) {
  const key = symbol + "|" + range;
  if (!MK.hist[key]) MK.hist[key] = api(`/api/trading/history?symbol=${encodeURIComponent(symbol)}&range=${range}`).catch((e) => ({ source: "error", reason: e.message, candles: [] }));
  return MK.hist[key];
}

const mkParams = (id) => Object.fromEntries(MK_STRATS[id].params.map(([k, , def]) => [k, MK.bt.strat === id && MK.bt.params[k] != null ? MK.bt.params[k] : def]));

async function mkRunBt() {
  const out = $("mk-bt-out"), bt = MK.bt;
  if (!out) return;
  out.innerHTML = ui.skeleton(8);
  const h = await mkCandles(bt.symbol, bt.range);
  if (!$("mk-bt-out")) return;
  if (h.candles.length < 60) { out.innerHTML = ui.empty("alert", "Sem histórico suficiente", h.reason || "Escolhe outro símbolo ou um período maior."); MK.hist[bt.symbol + "|" + bt.range] = null; return; }
  const r = mkBacktest(h.candles, MK_STRATS[bt.strat], mkParams(bt.strat), bt.capital || 10000, bt.fee || 0);
  MK.bt.result = r;
  const m = r.m, beat = m.ret - m.hold;
  const kpi = (l, v, sub = "", cls = "") => `<div class="panel bd-kpi"><span class="bd-l">${t(l)}</span><span class="num ${cls}">${v}</span>${sub ? `<small class="faint">${sub}</small>` : ""}</div>`;
  const dates = h.candles.map((x) => x[0]);
  out.innerHTML = `<div class="bd-kpis mk-kpis">
      ${kpi("Retorno da estratégia", mkPct(m.ret), t("{v} no fim", { v: mkUsd(m.final, 0) }), mkTone(m.ret))}
      ${kpi("Comprar e manter", mkPct(m.hold), t("mesmo período"), mkTone(m.hold))}
      ${kpi("Diferença", mkPct(beat), t(beat >= 0 ? "a estratégia ganhou" : "manter era melhor"), mkTone(beat))}
      ${kpi("Por ano (CAGR)", m.cagr == null ? "—" : mkPct(m.cagr))}
      ${kpi("Queda máxima", mkPct(m.mdd), t("manter: {p}", { p: mkPct(m.hold_mdd) }), "down")}
      ${kpi("Sharpe", m.sharpe == null ? "—" : mkFx(m.sharpe, 2), t("retorno por risco"))}
      ${kpi("Trades", String(m.trades), m.win == null ? "" : t("{p} ganhadores", { p: mkFx(m.win, 0) + "%" }))}
      ${kpi("Tempo no mercado", mkFx(m.exposure, 0) + "%")}</div>
    <section class="panel mk-card">${mkHead("Capital ao longo do tempo", `${esc(h.source)} · ${esc(h.source_symbol)}`)}
      <div class="mk-legend"><span><i style="background:${MK_COLORS.strat}"></i>${esc(t(MK_STRATS[bt.strat].name))}</span><span><i style="background:${MK_COLORS.hold}"></i>${t("Comprar e manter")}</span></div>
      ${mkChart("eq", dates, [{ name: MK_STRATS[bt.strat].name, color: MK_COLORS.strat, values: r.eq, area: true }, { name: "Comprar e manter", color: MK_COLORS.hold, values: r.bh }], { h: 280, money: true })}
      ${mkChart("dd", dates, [{ name: "Queda desde o máximo", color: "var(--bad)", values: r.dd, area: true }], { h: 110, pct: true, zero: true })}</section>
    <section class="panel mk-card">${mkHead("Preço e sinais", t("▲ entrada · ▼ saída"))}
      ${mkChart("px", dates, [{ name: "Preço", color: "var(--text)", values: h.candles.map((x) => x[4]) }], { h: 240, marks: r.trades })}</section>
    <section class="panel mk-card">${mkHead("Trades", t("{n} no período", { n: r.trades.length }))}${r.trades.length ? `<div class="mk-scroll"><table class="tbl mk-tbl"><thead><tr><th>${t("Entrada")}</th><th class="r">${t("Preço")}</th><th>${t("Saída")}</th><th class="r">${t("Preço")}</th><th class="r">${t("Dias")}</th><th class="r">${t("Resultado")}</th></tr></thead>
      <tbody>${r.trades.slice().reverse().map((x) => `<tr><td>${mkDate(dates[x.from])}</td><td class="r mono">${mkPrice(x.buy)}</td><td>${x.open ? `<span class="mk-rate flat">${t("em aberto")}</span>` : mkDate(dates[x.to])}</td>
        <td class="r mono">${mkPrice(x.sell)}</td><td class="r mono">${Math.round((dates[x.to] - dates[x.from]) / 86400)}</td><td class="r mono ${mkTone(x.ret)}"><b>${mkPct(x.ret * 100)}</b></td></tr>`).join("")}</tbody></table></div>`
      : mkNone("A estratégia não deu nenhum sinal neste período.")}</section>
    ${MK.bt.ranking && MK.bt.ranking.key === bt.symbol + "|" + bt.range ? mkRankingHtml(MK.bt.ranking) : ""}
    <p class="mk-foot">${t("Teste em dados passados: não inclui impostos, deslizes de preço nem dividendos. Resultados passados não garantem resultados futuros.")}</p>`;
  mkHookCharts(out);
}

async function mkRunAll() {
  const bt = MK.bt, h = await mkCandles(bt.symbol, bt.range);
  if (h.candles.length < 60) return flash(t("Sem histórico suficiente para {s}", { s: bt.symbol }));
  const rows = Object.entries(MK_STRATS).map(([id, s]) => {
    const p = Object.fromEntries(s.params.map(([k, , def]) => [k, def]));
    return { id, name: s.name, ...mkBacktest(h.candles, s, p, bt.capital || 10000, bt.fee || 0).m };
  }).sort((a, b) => b.ret - a.ret);
  MK.bt.ranking = { key: bt.symbol + "|" + bt.range, rows };
  await mkRunBt();
  document.querySelector(".mk-rank")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function mkRankingHtml(rank) {
  const hold = rank.rows[0]?.hold;
  return `<section class="panel mk-card mk-rank">${mkHead("Todas as estratégias neste símbolo", t("comprar e manter: {p}", { p: mkPct(hold) }))}<div class="mk-scroll"><table class="tbl mk-tbl">
    <thead><tr><th>#</th><th>${t("Estratégia")}</th><th class="r">${t("Retorno")}</th><th class="r">${t("vs manter")}</th><th class="r">${t("Queda máx.")}</th><th class="r">Sharpe</th><th class="r">${t("Trades")}</th><th class="r">${t("Acerto")}</th></tr></thead>
    <tbody>${rank.rows.map((x, i) => `<tr class="go ${x.id === MK.bt.strat ? "on" : ""}" data-bt-strat="${x.id}"><td class="mono faint">${i + 1}</td><td><b>${esc(t(x.name))}</b></td>
      <td class="r mono ${mkTone(x.ret)}"><b>${mkPct(x.ret)}</b></td><td class="r mono ${mkTone(x.ret - x.hold)}">${mkPct(x.ret - x.hold)}</td><td class="r mono down">${mkPct(x.mdd)}</td>
      <td class="r mono">${x.sharpe == null ? "—" : mkFx(x.sharpe, 2)}</td><td class="r mono">${x.trades}</td><td class="r mono">${x.win == null ? "—" : mkFx(x.win, 0) + "%"}</td></tr>`).join("")}</tbody></table></div></section>`;
}

/* ---------- a line chart in SVG, with a crosshair and a tooltip ---------- */
function mkNice(span, count) {
  const raw = span / count, p = 10 ** Math.floor(Math.log10(raw || 1)), m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

function mkChart(id, dates, series, opts = {}) {
  const W = 1000, H = opts.h || 260, L = 64, R = 14, T = 10, B = 24, n = dates.length;
  const all = series.flatMap((s) => s.values).filter((v) => v != null && isFinite(v));
  let lo = Math.min(...all), hi = Math.max(...all);
  if (opts.zero) { hi = Math.max(hi, 0); lo = Math.min(lo, 0); }
  if (hi === lo) { hi += 1; lo -= 1; }
  const step = mkNice(hi - lo, 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const x = (i) => L + (W - L - R) * (n <= 1 ? 0 : i / (n - 1)), y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const label = (v) => (opts.pct ? mkFx(v, 0) + "%" : opts.money ? mkBig(v, true) : mkPrice(v));
  let grid = "";
  for (let v = lo; v <= hi + step / 2; v += step) grid += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="gt" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${label(v)}</text>`;
  const ticks = 5;
  for (let j = 0; j < ticks; j++) {
    const i = Math.round((n - 1) * j / (ticks - 1));
    grid += `<text class="gt" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${j === 0 ? "start" : j === ticks - 1 ? "end" : "middle"}">${mkDate(dates[i])}</text>`;
  }
  const lines = series.map((s) => {
    const pts = s.values.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
    const area = s.area ? `<path d="M${x(0).toFixed(1)},${y(opts.zero ? 0 : lo).toFixed(1)} L${pts.join(" L")} L${x(n - 1).toFixed(1)},${y(opts.zero ? 0 : lo).toFixed(1)} Z" fill="${s.color}" opacity=".1"/>` : "";
    return `${area}<polyline points="${pts.join(" ")}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  }).join("");
  const marks = (opts.marks || []).map((tr) => {
    const v = series[0].values;
    const a = `<path class="mk-in" d="M${x(tr.from).toFixed(1)},${(y(v[tr.from]) + 6).toFixed(1)} l-6,10 h12 Z"><title>${t("Entrada")} ${mkDate(dates[tr.from])} · ${mkPrice(tr.buy)}</title></path>`;
    return a + (tr.open ? "" : `<path class="mk-out" d="M${x(tr.to).toFixed(1)},${(y(v[tr.to]) - 6).toFixed(1)} l-6,-10 h12 Z"><title>${t("Saída")} ${mkDate(dates[tr.to])} · ${mkPrice(tr.sell)} (${mkPct(tr.ret * 100)})</title></path>`);
  }).join("");
  MK.charts[id] = { dates, series, x, y, L, R, W, label, n };
  return `<div class="mk-chartbox" data-chart="${id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => t(s.name)).join(" · "))}">${grid}${lines}${marks}
    <line class="mk-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" hidden/>${series.map((s, k) => `<circle class="mk-hdot" data-k="${k}" r="4.5" fill="${s.color}" hidden/>`).join("")}</svg><div class="mk-tip" hidden></div></div>`;
}

function mkHookCharts(scope) {
  scope.querySelectorAll(".mk-chartbox").forEach((box) => {
    const c = MK.charts[box.dataset.chart], svg = box.querySelector("svg"), tip = box.querySelector(".mk-tip"), cross = svg.querySelector(".mk-cross");
    if (!c) return;
    svg.onmousemove = (e) => {
      const rect = svg.getBoundingClientRect(), px = (e.clientX - rect.left) / rect.width * c.W;
      const i = Math.max(0, Math.min(c.n - 1, Math.round((px - c.L) / (c.W - c.L - c.R) * (c.n - 1))));
      const cx = c.x(i);
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.hidden = false;
      svg.querySelectorAll(".mk-hdot").forEach((dot) => {
        const v = c.series[Number(dot.dataset.k)].values[i];
        dot.hidden = v == null;
        if (v != null) { dot.setAttribute("cx", cx); dot.setAttribute("cy", c.y(v)); }
      });
      tip.hidden = false;
      tip.innerHTML = `<b>${mkDate(c.dates[i])}</b>${c.series.map((s) => `<span><i style="background:${s.color}"></i>${esc(t(s.name))}<em>${s.values[i] == null ? "—" : c.label(s.values[i])}</em></span>`).join("")}`;
      const left = (cx / c.W) * rect.width;
      tip.style.left = `${Math.min(rect.width - tip.offsetWidth - 4, Math.max(4, left + 12))}px`;
    };
    svg.onmouseleave = () => { tip.hidden = true; cross.hidden = true; svg.querySelectorAll(".mk-hdot").forEach((d) => { d.hidden = true; }); };
  });
}

/* ================================================================ Mapas: TradingView's heatmaps, screeners and calendar */
const MK_MAPS = [["stocks", "Ações S&P 500"], ["crypto", "Cripto"], ["etf", "ETFs"], ["screener", "Screener de ações"], ["cscreener", "Screener de cripto"], ["forex", "Forex"], ["calendar", "Calendário"]];

MK_VIEWS.mapas = async (body) => {
  body.innerHTML = `<div class="segx mk-maps" id="mk-maps"></div><section class="panel mk-map" id="mk-map"></section>`;
  mkPaintMap();
};

function mkPaintMap() {
  const seg = $("mk-maps"), el = $("mk-map");
  if (!seg || !el) return;
  seg.innerHTML = MK_MAPS.map(([id, l]) => `<button class="${id === MK.map ? "on" : ""}" data-map="${id}">${t(l)}</button>`).join("");
  const full = { width: "100%", height: "100%" };
  const heat = { hasTopBar: true, isDataSetEnabled: true, isZoomEnabled: true, hasSymbolTooltip: true, isMonoSize: false, symbolUrl: "", ...full };
  const maps = {
    stocks: ["stock-heatmap", { dataSource: "SPX500", blockSize: "market_cap_basic", blockColor: "change", grouping: "sector", exchanges: [], ...heat }],
    crypto: ["crypto-coins-heatmap", { dataSource: "Crypto", blockSize: "market_cap_calc", blockColor: "24h_close_change|5", ...heat }],
    etf: ["etf-heatmap", { dataSource: "AllUSEtf", blockSize: "aum", blockColor: "change", grouping: "asset_class", ...heat }],
    screener: ["screener", { defaultColumn: "overview", defaultScreen: "most_capitalized", market: "america", showToolbar: true, ...full }],
    cscreener: ["screener", { defaultColumn: "overview", screener_type: "crypto_mkt", displayCurrency: "USD", market: "crypto", showToolbar: true, ...full }],
    forex: ["forex-cross-rates", { currencies: ["EUR", "USD", "JPY", "GBP", "CHF", "AUD", "CAD", "CNY"], ...full }],
    calendar: ["events", { locale: "en", importanceFilter: "-1,0,1", countryFilter: "us,eu,de,gb,fr,it,es,pt,cn,jp", ...full }],
  };
  const [name, config] = maps[MK.map] || maps.stocks;
  mkTv(el, name, config);
}
