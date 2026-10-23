// Sala de Trading (#/trading): the trading desk of the Empresa AMG. The room's read of the markets
// (backend/app/tradingroom/: candles from TradingView's feed, Smart Money Concepts on five timeframes), a chart that
// draws all of it (gaps, blocks, liquidity, sweeps, BOS/CHoCH, killzones, premium/discount, the setups), the meeting
// table of its two traders, the Pinguim (macro and news) and the Duas-Caras (the chart), the calendar and the
// headlines. Also the big alert (showAlert), which trading-alert.js opens on any page.
// Fetched the first time the page or an alert opens (lazyView). Live: the "trading" event, about once a minute.
(function () {
  // the chart's colours: up and down are the Hub's green and red, the liquidity its amber; blue and violet only tell the
  // order blocks and the accounts' lines apart on the chart
  const UP = "#5fcf8c", DOWN = "#ef6f5e", GOLD = "#e2b55c", BLUE = "#5aa9ff", VIOLET = "#a77bff", INK = "#07080a";
  const TFS = ["M5", "M15", "H1", "H4", "D1"];
  const TF_SEC = { M5: 300, M15: 900, H1: 3600, H4: 14400, D1: 86400 };
  const LAYERS = [["fvg", "FVG"], ["ob", "OB"], ["liq", "Liquidez"], ["bos", "BOS/CHoCH"], ["kz", "Killzones"], ["pd", "Premium/desconto"], ["vwap", "VWAP"], ["ema", "EMA 9/21/50"], ["setup", "Setup"]];
  const PEOPLE = { penguin: { name: "Macro", what: "Macro e notícias" }, twoface: { name: "Análise técnica", what: "Gráfico (SMC)" } };
  const STATE_PT = { intact: "intacto", swept: "varrido", taken: "rompido", testing: "a testar" };
  const STATUS_PT = { armed: "à espera do preço", active: "preço na zona", won: "alvo atingido" };
  const KIND_LABEL = { smc: "SMC", vwap: "VWAP + EMA", ib: "Inside bar D1", ema: "EMA 125/200" };
  const DIR_PT = { buy: "Compra", sell: "Venda", compra: "Compra", venda: "Venda", esperar: "Esperar" };

  let S = null, chartData = null, view = { n: 120, off: 0 }, hover = null, drag = null, openMeeting = null, clockTimer = 0, chartAt = 0, openTrade = null;
  const bookFilter = { agent: "", status: "", symbol: "" };
  let bookShow = 30;   // the book shows the newest 30 and grows on request (a phone would otherwise get hundreds of cards)
  let sel = localStorage.getItem("trading.sel") || "XAUUSD", tf = localStorage.getItem("trading.tf") || "M15";
  let layers = Object.assign({ fvg: 1, ob: 1, liq: 1, bos: 1, kz: 1, pd: 0, vwap: 1, ema: 0, setup: 1 }, JSON.parse(localStorage.getItem("trading.layers") || "{}"));

  const num = (v, dp) => (v == null || Number.isNaN(v) ? "—" : Number(v).toLocaleString("pt-PT", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const pct = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2).replace(".", ",")}%`);
  const sign = (v) => (v == null ? "" : v >= 0 ? "up" : "down");
  const hm = (t) => new Date(t).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  const ago = (sec) => { const m = Math.max(0, Math.round((Date.now() / 1000 - sec) / 60)); return m < 60 ? t("há {n} min", { n: m }) : m < 1440 ? t("há {n} h", { n: Math.round(m / 60) }) : t("há {n} d", { n: Math.round(m / 1440) }); };
  // the portrait is kept here as a picture, drawn under a key of its own: a frame the cave keeps can come back blank
  // (Chrome drops the contents of canvases it put away), and a blank one is never kept
  const faces = {};
  const portrait = (who) => {
    if (faces[who]) return faces[who];
    const P = window.CrewPeople, url = P && P.LOOKS && P.LOOKS[who] ? P.portrait(P.LOOKS[who], `${who}:${Date.now()}`) : "";
    if (url.length > 400) faces[who] = url;
    return url;
  };
  const nyHour = (() => {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false });
    return (sec) => { const p = f.formatToParts(new Date(sec * 1000)); const h = +p.find((x) => x.type === "hour").value % 24; return h + +p.find((x) => x.type === "minute").value / 60; };
  })();

  // ================================================================ the page
  // The standard anatomy of a Hub page (docs/hub-paginas.md): the head with the actions and the Claude switch as the
  // state, the sessions as the row of figures, then one section per idea, in the order the desk uses them.
  const FOCUS = ["XAUUSD", "EURUSD", "GER40", "GBPUSD"];   // what the team trades; the room reads a few more
  // a section label (ui.sec), with a short hint on the right (hidden on the phone) and maybe a control after it
  const sec = (title, hint = "", id = "", extra = "") => `<div class="sec"><span${id ? ` id="${id}"` : ""}>${esc(t(title))}</span>${hint || extra
    ? `<small class="tr-sr">${hint ? `<span class="tr-sr-t">${hint}</span>` : ""}${extra}</small>` : ""}</div>`;
  HUB_VIEWS.trading = async function () {
    await Promise.all([lazyFile("hub/crew-people.js").catch(() => {}), lazyFile("hub/trading-book.css").catch(() => {})]);
    const actions = `<label class="tr-switch" title="${esc(t("Ligado: as reuniões são dois Claudes a sério, neste PC (gasta do plano deste computador). Desligado: a reunião é escrita a partir dos números."))}">
        <input type="checkbox" id="tr-claude"><i></i><span id="tr-claude-l">${esc(t("Claude neste PC"))}</span></label>
      <select id="tr-model" class="inp tr-model" title="${esc(t("Modelo do Claude nas reuniões"))}"></select>
      <button type="button" class="btn quiet" id="tr-test" title="${esc(t("Mostra o aviso grande com o que a sala vê agora (só neste ecrã)"))}">${icon("bell")}${esc(t("Ver o aviso"))}</button>
      <button type="button" class="btn primary" id="tr-meet">${icon("users")}${esc(t("Convocar reunião"))}</button>`;
    page(`<div class="tr" id="tr">
      ${ui.head("Trading", t("Sala de Trading"), t("A mesa da AMG Capital: o Macro lê as notícias, a Análise técnica lê o gráfico e os dois reúnem-se para decidir as trades."), actions)}
      <section class="bd-stats tr-clock" id="tr-clocks"></section>
      ${sec("Mercados", esc(t("toca num para o abrir no gráfico")))}
      <section class="tr-radar" id="tr-radar"></section>
      <div class="tr-also" id="tr-also"></div>
      <div id="tr-react-w" hidden><div id="tr-react-h"></div><section class="panel pad tr-react" id="tr-react"></section></div>
      <div id="tr-live-w" hidden>${sec("Trades em jogo agora", esc(t("o plano de cada uma, a hora ideal e se ainda dá para entrar")))}<section class="tr-live" id="tr-live"></section></div>
      <div class="tr-main">
        <div class="tr-left">
          ${sec("Gráfico", esc(t("arrasta para andar no tempo · roda para aproximar · duplo clique volta ao início")))}
          <section class="panel tr-chartbox">
            <div class="tr-chartbar">
              <div class="tr-sym" id="tr-sym"></div>
              <div class="segx tr-tfs" id="tr-tfs">${TFS.map((x) => `<button type="button" data-tf="${x}">${x}</button>`).join("")}</div>
            </div>
            <div class="tr-layers" id="tr-layers">${LAYERS.map(([k, l]) => `<button type="button" class="chp" data-layer="${k}">${esc(t(l))}</button>`).join("")}</div>
            <div class="tr-canvas"><canvas id="tr-chart"></canvas><div class="tr-tip" id="tr-tip" hidden></div><p class="tr-wait" id="tr-wait">${esc(t("A ler o mercado…"))}</p></div>
          </section>
          ${sec("Leitura", "", "tr-read-h")}
          <section class="panel pad tr-read" id="tr-read"></section>
          ${sec("Contexto institucional", "", "tr-inst-h")}
          <section class="panel pad tr-inst" id="tr-inst"></section>
        </div>
        <aside class="tr-aside">
          ${sec("Mesa de reunião")}
          <section class="panel pad tr-table" id="tr-table"></section>
        </aside>
      </div>
      ${sec("Placar das contas", esc(t("cada conta a 1% de risco por trade · toca numa para ver as trades dela")))}
      <section class="cards tr-score" id="tr-score"></section>
      ${sec("Diário de trades", esc(t("cada trade seguida vela a vela · R = múltiplos do risco, spread descontado")))}
      <section class="panel tr-book">
        <div class="tr-book-f" id="tr-book-f">
          <select class="inp" data-f="agent"><option value="">${esc(t("Todas as contas"))}</option>${Object.keys(NAMES).map((k) => `<option value="${k}">${esc(t(NAMES[k]))}</option>`).join("")}</select>
          <select class="inp" data-f="status"><option value="">${esc(t("Todos os estados"))}</option><option value="pending,open">${esc(t("Ativas"))}</option><option value="won,lost,be">${esc(t("Fechadas"))}</option><option value="won">${esc(t("Boas"))}</option><option value="lost">${esc(t("Más"))}</option><option value="expired,missed,cancelled,refused">${esc(t("Não entraram"))}</option></select>
          <select class="inp" data-f="symbol"><option value="">${esc(t("Todos os instrumentos"))}</option></select>
        </div>
        <div class="tr-book-t" id="tr-book"></div>
      </section>
      ${sec("Backtest do Modelo SMC", esc(t("as regras da sala, vela a vela, sem olhar para o futuro")), "", `<button type="button" class="btn sm" id="tr-bt-run">${esc(t("Correr o backtest"))}</button>`)}
      <section class="panel pad tr-bt"><div id="tr-bt"></div></section>
      <div class="tr-lower">
        <div>${sec("Calendário económico", esc(t("alto e médio impacto · hora de Lisboa")))}<section class="panel tr-cal"><div id="tr-cal"></div></section></div>
        <div>${sec("Manchetes", "Reuters · Dow Jones · FXStreet")}<section class="panel tr-news"><div id="tr-news"></div></section></div>
      </div>
      ${sec("Contexto", esc(t("o dólar, os juros, o petróleo e o medo do mercado · variação do dia")))}
      <section class="bd-stats tr-ctx" id="tr-tape"></section>
    </div>`);
    const root = $("tr");
    root.querySelector("#tr-tfs").onclick = (e) => { const b = e.target.closest("[data-tf]"); if (b) { tf = b.dataset.tf; localStorage.setItem("trading.tf", tf); view = { n: 120, off: 0 }; loadChart(true); paintBar(); } };
    root.querySelector("#tr-layers").onclick = (e) => { const b = e.target.closest("[data-layer]"); if (b) { layers[b.dataset.layer] = layers[b.dataset.layer] ? 0 : 1; localStorage.setItem("trading.layers", JSON.stringify(layers)); paintBar(); drawMain(); } };
    root.querySelector("#tr-radar").onclick = (e) => { const b = e.target.closest("[data-sym]"); if (b) pick(b.dataset.sym); };
    root.querySelector("#tr-also").onclick = (e) => { const b = e.target.closest("[data-sym]"); if (b) pick(b.dataset.sym); };
    root.querySelector("#tr-meet").onclick = () => meet();
    root.querySelector("#tr-test").onclick = async (e) => { const b = e.currentTarget; b.disabled = true; try { showAlert(await api("/api/trading-room/alerts/test", { method: "POST" })); } finally { b.disabled = false; } };
    root.querySelector("#tr-claude").onchange = (e) => setting({ claude: e.target.checked });
    root.querySelector("#tr-model").onchange = (e) => setting({ model: e.target.value });
    root.querySelector("#tr-table").onclick = (e) => {
      const m = e.target.closest("[data-meeting]"); if (m) { openMeeting = Number(m.dataset.meeting); paintTable(); return; }
      if (e.target.closest("[data-meet]")) meet();
      const f = e.target.closest("[data-focus]"); if (f) pick(f.dataset.focus);
    };
    root.querySelector("#tr-book-f").onchange = (e) => { const f = e.target.closest("[data-f]"); if (f) { bookFilter[f.dataset.f] = f.value; bookShow = 30; paintBook(); } };
    root.querySelector("#tr-book").onclick = (e) => {
      if (e.target.closest("[data-more-trades]")) { bookShow += 30; paintBook(); return; }
      const r = e.target.closest("[data-trade]"); if (!r) return;
      openTrade = openTrade === r.dataset.trade ? null : r.dataset.trade; paintBook();
    };
    root.querySelector("#tr-score").onclick = (e) => { const c = e.target.closest("[data-agent]"); if (c) { bookFilter.agent = bookFilter.agent === c.dataset.agent ? "" : c.dataset.agent; $("tr-book-f").querySelector('[data-f="agent"]').value = bookFilter.agent; paintBook(); $("tr-book").scrollIntoView({ behavior: "smooth", block: "start" }); } };
    root.querySelector("#tr-bt-run").onclick = async () => { BT = { ...(BT || {}), ...(await api("/api/trading-room/backtest", { method: "POST" })) }; paintBacktest(); };
    bindChart($("tr-chart"));
    paintBar();
    clearInterval(clockTimer);
    // every second only the clock's text changes; the sessions and the calendar's countdowns are redrawn every 10 s
    clockTimer = setInterval(() => { if (!$("tr")) { clearInterval(clockTimer); return; } if (document.hidden) return; paintClocks(); if (new Date().getSeconds() % 10 === 0) paintCal(); }, 1000);
    await load();
    loadChart(true);
    loadBacktest();
  };

  // ================================================================ the backtest of the model
  let BT = null, btTimer = 0;
  async function loadBacktest() {
    clearTimeout(btTimer);
    if (!$("tr-bt")) return;
    try { BT = await api("/api/trading-room/backtest"); } catch (e) { return; }
    paintBacktest();
  }
  function paintBacktest() {
    const el = $("tr-bt"), btn = $("tr-bt-run"); if (!el || !BT) return;
    clearTimeout(btTimer);
    if (BT.running) btTimer = setTimeout(loadBacktest, 4000);
    btn.disabled = !!BT.running;
    btn.textContent = BT.running ? `${t("A correr…")} ${Math.round((BT.progress || 0) * 100)}%` : t("Correr o backtest");
    const r = BT.result, day = (ts) => new Date(ts * 1000).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" });
    const note = BT.running ? `<p class="tr-bt-n">${esc(t("A reler o passado vela a vela: demora uns 5 minutos e não pára a sala."))}</p>`
      : BT.error ? `<p class="tr-bt-n down">${esc(t("O último teste falhou:"))} ${esc(BT.error)}</p>` : "";
    if (!r) { paint(el, note || `<p class="tr-bt-n">${esc(t("Ainda sem nenhum teste. Carrega em «Correr o backtest»."))}</p>`); return; }
    const s = r.stats, c = r.counts || {};
    const row = (name, g) => `<tr><td>${esc(name)}</td><td>${g.n}</td><td>${g.n ? Math.round(g.w / g.n * 100) : 0}%</td><td class="${g.r >= 0 ? "up" : "down"}">${rfmt(g.r)}</td></tr>`;
    const table = (title, o, names = {}) => `<table class="tr-bt-t"><thead><tr><th>${esc(t(title))}</th><th>${esc(t("Trades"))}</th><th>${esc(t("Acerto"))}</th><th>R</th></tr></thead><tbody>${
      Object.entries(o || {}).sort((p, q) => q[1].r - p[1].r).map(([k, g]) => row(t(names[k] || k), g)).join("")}</tbody></table>`;
    paint(el, `${note}
      <div class="tr-bt-top">
        <div class="tr-sc-big"><strong class="${s.total_r >= 0 ? "up" : "down"}">${rfmt(s.total_r)}</strong><small>${s.return_pct >= 0 ? "+" : ""}${pctTxt(s.return_pct, 2)} ${esc(t("da conta (1% de risco por trade)"))}</small>
          <small>${day(r.from)} – ${day(r.to)} · ${nfx(r.days, 0)} ${esc(t("dias"))} · ${esc((r.instruments || []).join(", "))}</small></div>
        ${spark(s.curve, 320, 56)}
        <dl class="tr-sc-k">
          <div><dt>${esc(t("Trades"))}</dt><dd>${s.n}</dd></div>
          <div><dt>${esc(t("Acerto"))}</dt><dd>${s.winrate == null ? "—" : pctTxt(s.winrate)}</dd></div>
          <div><dt>${esc(t("Profit factor"))}</dt><dd>${s.pf == null ? "—" : nfx(s.pf)}</dd></div>
          <div><dt>${esc(t("Expectativa"))}</dt><dd class="${(s.avg_r || 0) >= 0 ? "up" : "down"}">${s.avg_r == null ? "—" : rfmt(s.avg_r)}</dd></div>
          <div><dt>${esc(t("Ganho / perda média"))}</dt><dd>${s.avg_win == null ? "—" : rfmt(s.avg_win)} / ${s.avg_loss == null ? "—" : rfmt(s.avg_loss)}</dd></div>
          <div><dt>${esc(t("Drawdown máx."))}</dt><dd>${s.max_dd ? "−" + nfx(s.max_dd) + "R" : "0R"}</dd></div>
        </dl>
      </div>
      <div class="tr-bt-g">${table("Instrumento", s.by_symbol)}${table("Nota", r.by_grade)}${table("Gráfico", r.by_tf)}${table("Lado", r.by_dir, { buy: "Compra", sell: "Venda" })}</div>
      <p class="tr-bt-n">${r.setups} ${esc(t("setups A/A+"))}: ${s.n} ${esc(t("entraram"))}, ${c.missed || 0} ${esc(t("fugiram sem entrar"))}, ${c.expired || 0} ${esc(t("expiraram"))}, ${c.refused || 0} ${esc(t("recusados pelas regras da conta"))}.
        ${esc(t("Só o modelo: o Macro e a Análise técnica leem notícias e não dá para os repetir no passado. Testado a"))} ${dt(r.at)}.</p>`);
  }

  // ================================================================ reaction to the US number in play (history from news-reaction)
  let RX = null;
  function paintReaction() {
    const el = $("tr-react"); if (!el) return;
    $("tr-react-w").hidden = !(RX && RX.key);
    if (!(RX && RX.key)) return;
    el.onclick = (e) => { const b = e.target.closest("[data-rx]"); if (b) pickReaction(b.dataset.rx === RX.key ? "" : b.dataset.rx); };
    const SP = { BELOW: "Abaixo da previsão", ABOVE: "Acima da previsão", INLINE: "Igual à previsão" };
    // only the markets this event has history for (GBP/USD came later than the rest)
    const SYM = [["GOLD", "Ouro"], ["EURUSD", "EUR/USD"], ["GER40", "GER40"], ["GBPUSD", "GBP/USD"]].filter(([k]) => Object.values(RX.table || {}).some((r) => r[k]));
    const pc = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${nfx(v)}%`);
    const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
    const fig = (v) => (v == null ? "—" : `${nfx(v, Number.isInteger(v) ? 0 : 1)}${RX.unit || ""}`);
    const out = !!RX.t && new Date(RX.t) <= new Date();
    const head = !RX.t ? esc(t("Sem data no calendário desta semana · o histórico de todas as saídas"))
      : out && RX.surprise
      ? `${esc(t("Saiu"))} <b>${fig(RX.actual)}</b> ${esc(t("contra"))} ${fig(RX.forecast)} ${esc(t("de previsão"))} ${ui.tag(t(SP[RX.surprise]), "warn")}`
      : `${esc(t("Sai"))} <b>${dt(RX.t)}</b> · ${esc(t("previsão"))} <b>${fig(RX.forecast)}</b> · ${esc(t("anterior"))} ${fig(RX.previous)}`;
    const rows = Object.keys(SP).map((s) => {
      const r = RX.table[s] || { n: 0 };
      return `<tr class="${out && RX.surprise === s ? "tr-rx-now" : ""}"><td>${esc(t(SP[s]))} <small>${r.n}×</small></td>${SYM.map(([k]) => {
        const c = r[k]; return `<td>${c ? `<b class="${cls(c.avg)}">${pc(c.avg)}</b><small>${esc(t("subiu {a} de {b}", { a: c.up, b: c.n }))}</small>` : "—"}</td>`;
      }).join("")}</tr>`;
    }).join("");
    const g = RX.gold;
    const lv = RX.live;
    const live = lv ? `<div class="tr-rx-live"><h4>${esc(t("Ouro agora"))}</h4>
        <p><b class="${cls(lv.now)}">${pc(lv.now)}</b> ${esc(t("desde a notícia"))} · ${lv.minutes} min · ${esc(t("mínimo"))} <b class="down">${pc(lv.low)}</b></p>
        <h4>${esc(t("As saídas passadas mais parecidas"))}</h4>
        <table class="tbl tr-rx-t"><thead><tr><th>${esc(t("Dia"))}</th><th>+60 min</th><th>+120 min</th><th>${esc(t("Voltou ao preço de antes?"))}</th></tr></thead><tbody>${
          lv.similar.map((x) => `<tr><td>${new Date(x.t).toLocaleDateString("pt-PT")} <small>${esc(t(SP[x.surprise]))}</small></td><td class="${cls(x.p60)}">${pc(x.p60)}</td><td class="${cls(x.p120)}">${pc(x.p120)}</td><td>${x.back ? esc(t("sim, em {m} min", { m: x.back })) : esc(t("não no próprio dia"))}</td></tr>`).join("")}</tbody></table></div>` : "";
    const tabs = (RX.tabs || []).filter((x) => x.has).map((x) => `<button type="button" data-rx="${x.key}" class="chp ${x.key === RX.key ? "on" : ""}">${esc(t(x.name))}${x.t ? `<small>${esc(rxWhen(x.t))}</small>` : ""}</button>`).join("");
    // the three outcomes at a glance: which way each market went in the first 5 minutes, and how often
    const cards = Object.keys(SP).map((s) => {
      const r = RX.table[s] || { n: 0 };
      return `<div class="tr-rx-c ${s} ${out && RX.surprise === s ? "now" : ""}"><b>${esc(t("Se sair"))} ${esc(t(SP[s]).toLowerCase())}</b>${out && RX.surprise === s ? ui.tag(t("Saiu assim"), "warn") : ""}<small>${esc(t("{n} vezes desde {y}", { n: r.n, y: RX.since }))}</small>
        <ul>${SYM.map(([k, n]) => { const c = r[k]; if (!c) return ""; const up = c.avg > 0, often = Math.max(c.up, c.n - c.up);
          return `<li><span>${esc(t(n))}</span><i class="${cls(c.avg)}">${up ? "▲" : "▼"}</i><b class="${cls(c.avg)}">${pc(c.avg)}</b><em>${esc(t(up ? "subiu {a} de {b}" : "desceu {a} de {b}", { a: up ? c.up : c.n - c.up, b: c.n }))}</em><u style="--w:${Math.round(often / Math.max(1, c.n) * 100)}%"></u></li>`; }).join("")}</ul></div>`;
    }).join("");
    paint($("tr-react-h"), sec("Reação à notícia", esc(t("{n} saídas desde {y} · os primeiros 5 min, velas de 1 minuto", { n: RX.count, y: RX.since }))));
    paint(el, `${tabs ? `<nav class="chipbar tr-rx-tabs">${tabs}</nav>` : ""}
      <h3 class="tr-rx-name">${esc(t(RX.name))}</h3>
      <p class="tr-rx-h">${head}</p>
      <div class="tr-rx-cards">${cards}</div>
      <div class="tr-rx-g">
        <div><table class="tbl tr-rx-t tr-rx-big"><thead><tr><th>${esc(t("O número saiu"))}</th>${SYM.map(([, n]) => `<th>${esc(t(n))}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
          <p class="tr-rx-n">${esc(t("Ouro com o número acima da previsão e a cair nos primeiros 5 min: 25 min depois estava mais alto em {a} de {b}. Quedas menores que 0,3% voltaram ao preço de antes em {c} de {d}{m}; de 0,3% ou mais, em {e} de {f}.", {
            a: g.bounce.back, b: g.bounce.n, c: g.small.back, d: g.small.n, m: g.small.minutes ? ` (${t("mediana {x} min", { x: g.small.minutes })})` : "", e: g.big.back, f: g.big.n }))}</p></div>
        ${live}
      </div>
      <p class="tr-rx-f">${esc(t("Frequências do passado em amostras pequenas, não uma garantia. Histórico: Dukascopy (news-reaction, {d}); ouro ao vivo: Binance XAUUSDT.", { d: RX.built || "—" }))}</p>`);
  }

  // the event chosen in the tabs (empty = the one in play); the click is wired once per paint
  let rxKey = "";
  const rxWhen = (iso) => { const d = new Date(iso), days = Math.round((d - Date.now()) / 864e5);
    return days < -0.2 ? t("saiu") : `${days < 1 && d.getDate() === new Date().getDate() ? t("hoje") : d.toLocaleDateString("pt-PT", { weekday: "short", day: "numeric" })} ${d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}`; };
  async function pickReaction(key) {
    rxKey = key;
    try { RX = await api(`/api/trading-room/reaction?key=${encodeURIComponent(key)}`); } catch (e) { return; }
    paintReaction();
  }
  async function load() {
    const [st, bk, rx] = await Promise.all([api("/api/trading-room/state"), api("/api/trading-room/trades?limit=400").catch(() => null), api(`/api/trading-room/reaction${rxKey ? `?key=${rxKey}` : ""}`).catch(() => null)]);
    S = st;
    if (bk) bookRows = bk.trades;
    RX = rx;
    if (!$("tr")) return;
    if (!S.instruments.some((a) => a.id === sel) && S.instruments[0]) sel = S.instruments[0].id;
    paintAll();
  }
  onLive(["trading"], async () => {
    if (!$("tr")) return;
    await load().catch(() => {});
    if (Date.now() - chartAt > 15000) loadChart(false);
  });
  function pick(id) { sel = id; localStorage.setItem("trading.sel", id); view = { n: 120, off: 0 }; paintRadar(); paintBar(); paintRead(); paintInst(); loadChart(true); $("tr-chart").scrollIntoView({ behavior: "smooth", block: "center" }); }
  async function setting(body) { try { S.settings = await api("/api/trading-room/settings", { method: "POST", body }); } catch (e) { /* shown by the next load */ } paintHead(); }
  async function meet() {
    const b = $("tr-meet"); if (b) b.disabled = true;
    try { await api("/api/trading-room/meet", { method: "POST", body: { focus: [sel] } }); openMeeting = null; await load(); }
    catch (e) { alert(String(e.message || e)); }
    finally { if (b) b.disabled = false; }
  }

  function paintAll() { paintHead(); paintClocks(); paintTape(); paintRadar(); paintScore(); paintLive(); paintBar(); paintRead(); paintInst(); paintTable(); paintBook(); paintReaction(); paintCal(); paintNews(); }

  function paintHead() {
    const st = S && S.settings; if (!st) return;
    const c = $("tr-claude"), m = $("tr-model");
    c.checked = st.claude; c.disabled = !st.installed;
    c.parentNode.classList.toggle("on", !!st.claude);
    $("tr-claude-l").textContent = !st.installed ? t("Claude não instalado") : st.claude ? t("Claude ligado · {n}/{c} hoje", { n: st.today, c: st.cap }) : t("Claude desligado");
    if (!m.options.length) m.innerHTML = st.models.map((x) => `<option value="${x}">${x[0].toUpperCase() + x.slice(1)}</option>`).join("");
    m.value = st.model; m.hidden = !st.claude;
    const running = S.meetings[0] && S.meetings[0].status === "running";
    $("tr-meet").disabled = running;
    $("tr-meet").innerHTML = `${icon("users")}${esc(running ? t("Em reunião…") : t("Convocar reunião"))}`;
  }

  // the row of figures under the head: the clock, the four sessions, and whether a killzone is on
  function paintClocks() {
    if (!S) return;
    const now = new Date(), kz = S.killzone, el = $("tr-clocks"), clock = el && el.querySelector(".tr-now b");
    if (clock && now.getSeconds() % 10 && el._S === S) { clock.textContent = now.toLocaleTimeString("pt-PT"); return; }
    if (el) el._S = S;
    const hm2 = (left) => ({ h: Math.floor(left / 60), m: String(left % 60).padStart(2, "0") });
    const ses = S.sessions.map((s) => {
      const left = Math.max(0, Math.round(((new Date(s.open ? s.closes : s.opens)) - now) / 60000));
      return `<div class="${s.open ? "on" : ""}"><span class="bd-l">${esc(t(s.name))}</span>
        <span class="st ${s.open ? "ok" : "off"}"><i></i>${esc(s.open ? t("Aberta") : t("Fechada"))}</span>
        <small>${esc(s.open ? t("fecha em {h}h{m}", hm2(left)) : t("abre em {h}h{m}", hm2(left)))}</small></div>`;
    }).join("");
    paint($("tr-clocks"), `<div class="tr-now"><span class="bd-l">${esc(t("Agora"))}</span><b>${now.toLocaleTimeString("pt-PT")}</b>
      <small class="${kz ? "tr-kz" : ""}">${kz ? `${esc(t("Killzone de {k}", { k: t(kz.name) }))}${kz.silver ? ` · ${esc(t("silver bullet"))}` : ""}` : esc(t("fora das killzones"))}</small></div>${ses}`);
  }

  // the context of the four: the dollar, the yields, oil, the VIX (the old moving tape, now still: nothing moves for nothing)
  const CNAME = { DXY: "Dólar (DXY)", US10Y: "Juro 10a EUA", USOIL: "Petróleo", VIX: "VIX", US02Y: "Juro 2a EUA", DE02Y: "Juro 2a Alemanha",
    GB02Y: "Juro 2a R. Unido", DE10Y: "Juro 10a Alemanha", REAL10: "Juro real 10a", BE10: "Inflação implícita 10a", SPX: "S&P 500", USDJPY: "USD/JPY" };
  function paintTape() {
    paint($("tr-tape"), (S.context || []).map((c) => `<div><span class="bd-l">${esc(t(CNAME[c.id] || c.id))}</span><b>${num(c.price, c.dp)}</b>
      <small class="${sign(c.chg)}">${c.chg == null ? esc(t("Sem dados")) : `${c.chg >= 0 ? "▲" : "▼"} ${pct(c.chg)}`}</small></div>`).join("") || ui.empty("chart", "Sem dados", "O contexto ainda não chegou."));
  }

  function trendArrow(tr) { return tr === "bull" ? `<i class="up">▲</i>` : tr === "bear" ? `<i class="down">▼</i>` : `<i>•</i>`; }
  // the team's four as cards; what else the room reads (Nasdaq, Dow, bitcoin) as a line under them
  function paintRadar() {
    const four = FOCUS.map((id) => S.instruments.find((a) => a.id === id)).filter(Boolean);
    const rest = S.instruments.filter((a) => !FOCUS.includes(a.id));
    paint($("tr-radar"), four.map((a) => {
      const s = a.setups[0], pd = a.pd == null ? null : Math.max(0, Math.min(1, a.pd));
      const up = a.above[0], dn = a.below[0];
      return `<button type="button" class="tr-card ${a.id === sel ? "on" : ""} b-${a.bias.dir}" data-sym="${a.id}">
        <div class="tr-card-h"><b>${a.id}</b><small>${esc(t(a.name))}</small>${a.open ? "" : `<span class="tr-closed">${esc(t("fechado"))}</span>`}${s ? `<span class="tr-grade g-${s.grade.replace("+", "p")}" title="${esc(t("Setup {g} do modelo", { g: s.grade }))}">${s.grade}</span>` : ""}</div>
        <div class="tr-card-p"><strong>${num(a.price, a.dp)}</strong><em class="${sign(a.chg)}">${pct(a.chg)}</em></div>
        <div class="tr-card-tf">${["D1", "H4", "H1", "M15"].map((x) => `<span>${x}${trendArrow(a.tf[x] && a.tf[x].trend)}</span>`).join("")}</div>
        <div class="tr-pd" title="${esc(t("Onde está o preço no range H4: à esquerda desconto, à direita premium"))}"><i style="left:${pd == null ? 50 : pd * 100}%"></i></div>
        <div class="tr-card-l"><span class="up">${up ? `▲ ${esc(short(up.label))} ${num(up.dist, 1)}` : "—"}</span><span class="down">${dn ? `▼ ${esc(short(dn.label))} ${num(dn.dist, 1)}` : "—"}</span></div>
      </button>`;
    }).join(""));
    paint($("tr-also"), rest.length ? `<span class="tr-also-l">${esc(t("Também na sala"))}</span>${rest.map((a) => `<button type="button" class="tr-also-b ${a.id === sel ? "on" : ""}" data-sym="${a.id}">
      <b>${a.id}</b><span>${num(a.price, a.dp)}</span><em class="${sign(a.chg)}">${pct(a.chg)}</em>${a.setups[0] ? `<i class="tr-grade g-${a.setups[0].grade.replace("+", "p")}">${a.setups[0].grade}</i>` : ""}</button>`).join("")}` : "");
  }
  const short = (label) => label.replace("máximo de ontem (PDH)", "PDH").replace("mínimo de ontem (PDL)", "PDL").replace("máximo da semana passada (PWH)", "PWH")
    .replace("mínimo da semana passada (PWL)", "PWL").replace("máximo da Ásia", "Ásia ↑").replace("mínimo da Ásia", "Ásia ↓").replace("máximo de Londres", "Londres ↑")
    .replace("mínimo de Londres", "Londres ↓").replace("Topos iguais", "EQH").replace("Fundos iguais", "EQL");

  function paintBar() {
    const a = S && S.instruments.find((x) => x.id === sel);
    $("tr-tfs").querySelectorAll("[data-tf]").forEach((b) => b.classList.toggle("on", b.dataset.tf === tf));
    $("tr-layers").querySelectorAll("[data-layer]").forEach((b) => b.classList.toggle("on", !!layers[b.dataset.layer]));
    if (a) paint($("tr-sym"), `<b>${a.id}</b><strong>${num(a.price, a.dp)}</strong><em class="${sign(a.chg)}">${pct(a.chg)}</em>${ui.tag(t(a.bias.text.split(" · ")[0]), a.bias.dir === "bull" ? "ok" : a.bias.dir === "bear" ? "bad" : "")}`);
  }

  // what the room reads in the chosen instrument: the bias, the key levels, the zones, the setups
  function paintRead() {
    const a = S && S.instruments.find((x) => x.id === sel); if (!a) return;
    const keys = a.keys.slice().sort((p, q) => q.p - p.p).map((k) => `<li class="k-${k.state}"><b>${k.key}</b><span>${num(k.p, a.dp)}</span><em>${esc(t(STATE_PT[k.state] || k.state))}</em></li>`).join("");
    const pois = a.pois.slice(0, 5).map((p) => `<li class="${p.dir}"><b>${p.type} ${p.tf}</b><span>${num(p.bot, a.dp)} – ${num(p.top, a.dp)}</span><em>${esc(p.dir === "up" ? t("compra") : t("venda"))}${p.inside ? " · " + esc(t("preço dentro")) : ""}</em></li>`).join("");
    const setups = a.setups.map((s) => setupCard(s, a)).join("") || `<p class="tr-none">${esc(t("Sem setup limpo agora. O SMC espera um sweep de liquidez, uma mudança de estrutura e uma zona para entrar; o VWAP + EMA espera um pullback rejeitado no VWAP a favor da tendência, e só aparece com nota A ou A+; no ouro e no Nasdaq, a inside bar do diário a favor da tendência."))}</p>`;
    const ev = a.events.slice(0, 6).map((e) => `<li><time>${hm(e.t * 1000)}</time>${esc(e.text.split(": ").slice(1).join(": "))}</li>`).join("");
    $("tr-read-h").textContent = t("Leitura de {s}", { s: a.id });
    paint($("tr-read"), `<div class="tr-read-grid">
      <div><h3>${esc(t("Viés"))}</h3><p class="tr-biastext">${esc(a.bias.text)}</p>
        ${a.pd != null ? `<p class="tr-pdtext">${esc(t("{p}% do range H4", { p: Math.round(a.pd * 100) }))} · <b class="${a.pd > .5 ? "down" : "up"}">${esc(a.pd > .5 ? t("premium (zona de vender)") : t("desconto (zona de comprar)"))}</b></p>` : ""}
        <h3>${esc(t("Liquidez-chave"))}</h3><ul class="tr-keys">${keys}</ul></div>
      <div><h3>${esc(t("Setups do modelo"))}</h3>${setups}</div>
      <div><h3>${esc(t("Zonas H1/H4"))}</h3><ul class="tr-pois">${pois || `<li>${esc(t("nenhuma perto do preço"))}</li>`}</ul>
        <h3>${esc(t("O que aconteceu"))}</h3><ul class="tr-events">${ev || `<li>${esc(t("nada de novo"))}</li>`}</ul></div>
    </div>`);
  }
  function setupCard(s, a) {
    const sell = s.dir === "sell";
    return `<article class="tr-setup ${sell ? "sell" : "buy"}${s.kind && s.kind !== "smc" ? " " + s.kind : ""}">
      <header><span class="tr-grade g-${s.grade.replace("+", "p")}">${s.grade}</span><b>${esc(t(sell ? "Venda" : "Compra"))} · ${s.tf}</b><span class="tr-kind">${KIND_LABEL[s.kind] || "SMC"}</span><em>${s.score}/100 · ${esc(t(STATUS_PT[s.status] || s.status))}</em></header>
      <dl><div><dt>${esc(t("Zona"))}</dt><dd>${num(s.zone[0], a.dp)} – ${num(s.zone[1], a.dp)}</dd></div><div><dt>${esc(t("Stop"))}</dt><dd class="down">${num(s.stop, a.dp)}</dd></div>
        <div><dt>${esc(t("Alvos"))}</dt><dd class="up">${s.targets.map((x) => num(x.p, a.dp)).join(" · ")}</dd></div><div><dt>RR</dt><dd>${num(s.rr, 1)}</dd></div></dl>
      <ul>${s.why.map((w) => `<li class="${/\(contra\)|\(lado errado\)|\(gasta\)|^Fica em B/.test(w) ? "bad" : ""}">${esc(w)}</li>`).join("")}</ul>
      ${s.news_risk && s.news_risk.length ? `<p class="tr-risk">${icon("alert")}${esc(t("Notícia perto"))}: ${esc(s.news_risk.join("; "))}</p>` : ""}
    </article>`;
  }

  // ================================================================ the scoreboard: each one's own account
  let bookRows = [];
  // every account of the book (book.AGENTS): the two traders, the model, and one per strategy (19 out)
  const NAMES = { penguin: "Macro", twoface: "Análise técnica", model: "Modelo", ema: "EMA 125/200", vwap: "VWAP + EMA", combo: "Combinado" };
  const ROLES = { penguin: "Macro e notícias", twoface: "Gráfico (SMC)", model: "Referência: os setups A e A+ do motor",
    ema: "Tendência nas EMA 125 e 200", vwap: "Pullback ao VWAP a favor da tendência", combo: "Só quando as três leituras concordam" };
  const side = (dir) => ui.tag(t(dir === "buy" ? "Compra" : "Venda"), dir === "buy" ? "ok" : "bad");
  const face = (agent, cls = "tr-sc-ico") => (PEOPLE[agent] ? `<img src="${portrait(agent)}" alt="">` : `<span class="${cls}">${bars()}</span>`);
  const pctTxt = (v, d = 1) => (v == null ? "—" : `${v.toFixed(d).replace(".", ",")}%`);
  const nfx = (v, d = 2) => (v == null ? "—" : v.toFixed(d).replace(".", ","));
  function spark(curve, w = 220, h = 46) {
    if (!curve.length) return `<svg class="tr-spark" viewBox="0 0 ${w} ${h}"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}"/></svg>`;
    const pts = [0, ...curve], lo = Math.min(0, ...pts), hi = Math.max(0, ...pts), span = hi - lo || 1;
    const X = (i) => (i / (pts.length - 1)) * (w - 4) + 2, Y = (v) => h - 3 - ((v - lo) / span) * (h - 6);
    const d = pts.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    const up = pts[pts.length - 1] >= 0;
    return `<svg class="tr-spark ${up ? "up" : "down"}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="0" x2="${w}" y1="${Y(0)}" y2="${Y(0)}"/>
      <path class="a" d="${d}L${X(pts.length - 1)},${Y(lo)}L${X(0)},${Y(lo)}Z"/><path d="${d}"/></svg>`;
  }
  function paintScore() {
    const list = S.stats || [];
    const lead = list.filter((s) => s.agent !== "model" && s.n).sort((p, q) => q.total_r - p.total_r)[0];
    paint($("tr-score"), list.map((s) => {
      const pic = face(s.agent);
      const streak = s.streak && s.streak.n ? `${s.streak.n} ${s.streak.kind === "w" ? t("ganhas") : s.streak.kind === "l" ? t("perdidas") : t("a zero")} ${t("seguidas")}` : "—";
      // an account with nothing closed yet says so, instead of a card of zeros
      if (!s.n) return `<button type="button" class="tr-sc empty ${s.agent} ${bookFilter.agent === s.agent ? "on" : ""}" data-agent="${s.agent}">
        <div class="tr-sc-h">${pic}<div><b>${esc(t(NAMES[s.agent] || s.name || s.agent))}</b><small>${esc(t(ROLES[s.agent] || ""))}</small></div></div>
        <p class="tr-sc-none">${esc(PEOPLE[s.agent] ? t("Ainda sem trades fechadas: só negoceia nas reuniões com o Claude ligado.") : t("Ainda sem trades fechadas: entra quando aparece um setup A ou A+ da estratégia."))}</p>
        <div class="tr-sc-f"><span></span><span>${s.open || 0} ${esc(t("abertas"))} · ${s.pending || 0} ${esc(t("pendentes"))}</span></div></button>`;
      return `<button type="button" class="tr-sc ${s.agent} ${lead && lead.agent === s.agent ? "lead" : ""} ${bookFilter.agent === s.agent ? "on" : ""}" data-agent="${s.agent}">
        <div class="tr-sc-h">${pic}<div><b>${esc(t(NAMES[s.agent] || s.name || s.agent))}</b><small>${esc(t(ROLES[s.agent] || ""))}</small></div>${lead && lead.agent === s.agent ? ui.tag(t("na frente"), "ok") : ""}</div>
        <div class="tr-sc-main">
          <div class="tr-ring ${s.winrate == null ? "none" : ""}" style="--p:${s.winrate || 0}"><b>${s.winrate == null ? "—" : Math.round(s.winrate) + "%"}</b><small>${esc(t("acerto"))}</small></div>
          <div class="tr-sc-big"><strong class="${s.total_r >= 0 ? "up" : "down"}">${rfmt(s.total_r)}</strong><small>${s.return_pct >= 0 ? "+" : ""}${pctTxt(s.return_pct, 2)} ${esc(t("da conta (1% de risco por trade)"))}</small>
            <div class="tr-sc-wl"><span class="w">${s.wins} ${esc(t("ganhas"))}</span><span class="l">${s.losses} ${esc(t("perdidas"))}</span><span class="b">${s.be} ${esc(t("a zero"))}</span></div></div>
        </div>
        ${spark(s.curve)}
        <dl class="tr-sc-k">
          <div><dt>${esc(t("Profit factor"))}</dt><dd>${s.pf == null ? "—" : s.pf >= 99 ? "∞" : nfx(s.pf)}</dd></div>
          <div><dt>${esc(t("Expectativa"))}</dt><dd class="${(s.avg_r || 0) >= 0 ? "up" : "down"}">${s.avg_r == null ? "—" : rfmt(s.avg_r)}</dd></div>
          <div><dt>${esc(t("Ganho médio"))}</dt><dd class="up">${s.avg_win == null ? "—" : rfmt(s.avg_win)}</dd></div>
          <div><dt>${esc(t("Perda média"))}</dt><dd class="down">${s.avg_loss == null ? "—" : rfmt(s.avg_loss)}</dd></div>
          <div><dt>${esc(t("Drawdown máx."))}</dt><dd>${s.max_dd ? "−" + nfx(s.max_dd) + "R" : "0R"}</dd></div>
          <div><dt>${esc(t("Série"))}</dt><dd>${esc(streak)}</dd></div>
        </dl>
        <div class="tr-sc-f"><span class="tr-last">${(s.last || []).map((r) => `<i class="${r > .05 ? "w" : r < -.05 ? "l" : "b"}" title="${rfmt(r)}"></i>`).join("")}</span>
          <span>${s.open} ${esc(t("abertas"))} · ${s.pending} ${esc(t("pendentes"))} · ${s.n} ${esc(t("fechadas"))}</span></div>
      </button>`;
    }).join(""));
  }

  // ================================================================ the book: every trade, good or bad
  // the state of a trade as a tag of the Hub: amber waits, green won, red lost, the rest neutral or faint
  const STATUS = { pending: ["pendente", "warn"], open: ["aberta", ""], won: ["ganha", "ok"], lost: ["perdida", "bad"], be: ["a zero", ""],
    expired: ["expirou", "tr-dim"], missed: ["fugiu sem entrar", "tr-dim"], cancelled: ["cancelada", "tr-dim"], refused: ["recusada", "tr-dim"],
    invalidated: ["ideia cancelada", "tr-dim"] };
  const CAN = { yes: "ainda dá para entrar", late: "entrou · ainda dá, junto à entrada", in: "já entrou · perdeste a entrada", no: "acabou" };
  const dt = (iso) => (iso ? new Date(iso).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
  const dur = (a, b) => { if (!a) return "—"; const m = Math.round(((b ? new Date(b) : new Date()) - new Date(a)) / 60000); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`; };
  // the trades in play now, one card each, in plain words: what we wait for, at what time, and whether it is still on
  function paintLive() {
    const live = bookRows.filter((tr) => tr.status === "pending" || tr.status === "open");
    const el = $("tr-live");
    $("tr-live-w").hidden = !live.length;
    if (!live.length) { paint(el, ""); return; }
    const PILL = { yes: ["À espera da entrada", "warn"], late: ["Entrou · ainda dá", ""], in: ["Entrou · já andou", "ok"], no: ["Acabou", "tr-dim"] };
    paint(el, `<div class="cards tr-live-g">${live.map((tr) => {
        const dp = tr.dp != null ? tr.dp : 2, can = (tr.now && tr.now.can) || "yes", [pill, tone] = PILL[can];
        const inWin = tr.win_from && Date.now() >= Date.parse(tr.win_from) && Date.now() <= Date.parse(tr.win_to);
        const who = face(tr.agent, "tr-who-s");
        return `<article class="panel tr-lc ${tr.dir} ${can}" data-trade="${tr.id}">
          <header>${who}<div><b>${esc(tr.symbol)} ${side(tr.dir)}</b><small>${esc(t(NAMES[tr.agent] || tr.agent))} · ${dt(tr.at)}</small></div>
            ${inWin && can === "yes" ? `<span class="tagx warn tr-hot">${esc(t("Hora ideal agora"))}</span>` : ui.tag(t(pill), tone)}</header>
          ${tr.plan ? `<p class="tr-lc-plan">${esc(tr.plan)}</p>` : `<p class="tr-lc-plan">${esc(tr.why)}</p>`}
          <dl class="tr-lc-k">
            ${tr.zone ? `<div><dt>${esc(t("Zona"))}</dt><dd>${num(tr.zone[0], dp)} – ${num(tr.zone[1], dp)}</dd></div>` : ""}
            <div><dt>${esc(t("Entrada"))}</dt><dd>${num(tr.entry, dp)}</dd></div>
            <div><dt>${esc(t("Stop"))}</dt><dd class="down">${num(tr.stop, dp)}</dd></div>
            <div><dt>${esc(t("Alvos"))}</dt><dd class="up">${num(tr.tp1, dp)}${tr.tp2 ? " · " + num(tr.tp2, dp) : ""}</dd></div>
            <div><dt>${esc(t("Hora ideal"))}</dt><dd>${tr.win_from ? `${hm(tr.win_from)}–${hm(tr.win_to)}` : "—"}</dd></div>
            <div><dt>${esc(t("Vale até"))}</dt><dd>${hm(tr.valid)}</dd></div>
          </dl>
          ${tr.trigger ? `<p class="tr-lc-trig"><b>${esc(t("Gatilho"))}:</b> ${esc(tr.trigger)}</p>` : ""}
          ${tr.now ? `<p class="tr-nowl ${can}">${esc(tr.now.line)}</p>` : ""}
        </article>`;
      }).join("")}</div>`);
    el.onclick = (e) => { const c = e.target.closest("[data-trade]"); if (c) { openTrade = c.dataset.trade; bookFilter.agent = ""; $("tr-book-f").querySelector('[data-f="agent"]').value = ""; paintBook(); $("tr-book").scrollIntoView({ behavior: "smooth", block: "start" }); } };
  }

  function paintBook() {
    const sf = $("tr-book-f").querySelector('[data-f="symbol"]');
    if (sf.options.length < 2 && S) sf.innerHTML += S.instruments.map((a) => `<option value="${a.id}">${a.id}</option>`).join("");
    const rows = bookRows.filter((tr) => (!bookFilter.agent || tr.agent === bookFilter.agent) && (!bookFilter.symbol || tr.symbol === bookFilter.symbol)
      && (!bookFilter.status || bookFilter.status.split(",").includes(tr.status)));
    if (!rows.length) { paint($("tr-book"), ui.empty("doc", bookRows.length ? "Nenhuma trade com estes filtros" : "Ainda sem trades", "Cada reunião com o Claude pode abrir até duas por agente; o Modelo SMC abre uma por cada setup A ou A+.")); return; }
    const shown = rows.slice(0, bookShow), more = rows.length - shown.length;
    paint($("tr-book"), `<table class="tbl tr-tbl"><thead><tr><th>${esc(t("Quando"))}</th><th>${esc(t("Quem"))}</th><th>${esc(t("Instrumento"))}</th><th>${esc(t("Direção"))}</th>
      <th class="n">${esc(t("Entrada"))}</th><th class="n">${esc(t("Stop"))}</th><th class="n">${esc(t("Alvos"))}</th><th class="n">RR</th><th>${esc(t("Estado"))}</th><th class="n">${esc(t("Resultado"))}</th><th>${esc(t("Avaliação"))}</th></tr></thead>
      <tbody>${shown.map((tr) => bookRow(tr)).join("")}</tbody></table>
      ${more > 0 ? `<div class="tr-more"><button type="button" class="btn sm" data-more-trades>${esc(t("Mostrar mais {n} de {m}", { n: Math.min(30, more), m: more }))}</button></div>` : ""}`);
  }
  function bookRow(tr) {
    const dp = tr.dp != null ? tr.dp : 2, [label, tone] = STATUS[tr.status] || [tr.status, "tr-dim"], open = openTrade === String(tr.id);
    const res = tr.r != null ? tr.r : tr.live_r;
    const grade = tr.outcome === "boa" ? ui.tag(t("Boa trade"), "ok") : tr.outcome === "má" ? ui.tag(t("Má trade"), "bad")
      : tr.outcome === "neutra" ? ui.tag(t("Neutra")) : tr.status === "open" ? ui.tag(t("Em curso")) : "—";
    const L = (k) => `data-l="${esc(t(k))}"`;
    const who = face(tr.agent, "tr-who-s");
    return `<tr class="${tr.status} ${open ? "open-row" : ""}" data-trade="${tr.id}">
      <td ${L("Quando")}>${dt(tr.at)}</td><td ${L("Quem")}><span class="tr-who-c">${who}${esc(t(NAMES[tr.agent] || tr.agent))}</span></td><td ${L("Instrumento")}><b>${esc(tr.symbol || "—")}</b></td>
      <td data-l="${esc(t("Direção"))}">${tr.dir ? side(tr.dir) : "—"}</td>
      <td class="n" ${L("Entrada")}>${tr.entry != null ? num(tr.entry, dp) : "—"}${tr.market ? `<small>${esc(t("a mercado"))}</small>` : ""}</td><td class="n" ${L("Stop")}>${tr.stop != null ? num(tr.stop, dp) : "—"}</td>
      <td class="n" ${L("Alvos")}>${tr.tp1 != null ? num(tr.tp1, dp) : "—"}${tr.tp2 ? ` · ${num(tr.tp2, dp)}` : ""}</td><td class="n" ${L("RR")}>${tr.rr ? nfx(tr.rr, 1) : "—"}</td>
      <td ${L("Estado")}>${ui.tag(t(label) + (tr.half && tr.status === "open" ? " · ½" : ""), tone)}${tr.now ? `<small class="tr-can ${tr.now.can}">${esc(t(CAN[tr.now.can]))}</small>` : ""}</td>
      <td class="n ${res == null ? "" : res >= 0 ? "up" : "down"}" ${L("Resultado")}>${res == null ? "—" : `${rfmt(res)}${tr.r == null ? "" : `<small>${res >= 0 ? "+" : ""}${pctTxt(res, 2)}</small>`}`}</td><td ${L("Avaliação")}>${grade}</td></tr>
      ${open ? `<tr class="tr-detail"><td colspan="11"><div class="tr-detail-g">
        <div>${tr.now ? `<p class="tr-nowl ${tr.now.can}">${esc(tr.now.line)}</p>` : ""}
          ${tr.plan ? `<h4>${esc(t("Plano"))}</h4><p>${esc(tr.plan)}</p>` : ""}${tr.trigger ? `<h4>${esc(t("Gatilho da entrada"))}</h4><p>${esc(tr.trigger)}</p>` : ""}
          <h4>${esc(t("Porquê"))}</h4><p>${esc(tr.why || "—")}</p>${tr.review ? `<h4>${esc(t("Revisão de quem a fez"))}</h4><p class="rev">${esc(tr.review)}</p>` : ""}</div>
        <dl>${tr.zone ? `<div><dt>${esc(t("Zona"))}</dt><dd>${num(tr.zone[0], dp)} – ${num(tr.zone[1], dp)}</dd></div>` : ""}
          ${tr.win_from ? `<div><dt>${esc(t("Hora ideal"))}</dt><dd>${hm(tr.win_from)}–${hm(tr.win_to)}</dd></div>` : ""}
          ${tr.invalid != null ? `<div><dt>${esc(t("Cancela se fechar além de"))}</dt><dd>${num(tr.invalid, dp)}</dd></div>` : ""}
          ${tr.best != null ? `<div><dt>${esc(t("Entrada perfeita (visto depois)"))}</dt><dd>${num(tr.best, dp)} ${esc(t("às"))} ${hm(tr.best_at)}</dd></div>` : ""}
          <div><dt>${esc(t("Entrou"))}</dt><dd>${dt(tr.filled_at)}</dd></div><div><dt>${esc(t("Saiu"))}</dt><dd>${dt(tr.closed_at)}</dd></div>
          <div><dt>${esc(t("Duração"))}</dt><dd>${tr.filled_at ? dur(tr.filled_at, tr.closed_at) : "—"}</dd></div><div><dt>${esc(t("Saída"))}</dt><dd>${tr.exit != null ? num(tr.exit, dp) : "—"}</dd></div>
          <div><dt>${esc(t("Melhor momento"))}</dt><dd class="up">${tr.mfe ? "+" + nfx(tr.mfe) + "R" : "—"}</dd></div><div><dt>${esc(t("Pior momento"))}</dt><dd class="down">${tr.mae ? "−" + nfx(tr.mae) + "R" : "—"}</dd></div>
          <div><dt>${esc(t("Custo (spread)"))}</dt><dd>${tr.cost ? nfx(tr.cost) + "R" : "—"}</dd></div><div><dt>${esc(t("Válida até"))}</dt><dd>${dt(tr.valid)}</dd></div></dl>
        ${tr.note ? `<p class="tr-note">${icon("alert")}${esc(tr.note)}</p>` : ""}</div></td></tr>` : ""}`;
  }

  // ================================================================ the institutional layer of the chosen instrument
  const DRIVERS = { XAUUSD: ["DXY", "REAL10", "US10Y", "VIX"], EURUSD: ["DXY", "US_DE_2Y", "US02Y"], GBPUSD: ["DXY", "US_GB_2Y", "US02Y"], GER40: ["SPX", "VIX", "US_DE_10Y"],
    NAS100: ["US10Y", "SPX", "VIX"], US30: ["SPX", "VIX", "US10Y"], BTCUSD: ["DXY", "SPX", "VIX"] };
  const DNAME = { DXY: "Dólar (DXY)", REAL10: "Juro real 10a", US10Y: "Juro 10a EUA", US02Y: "Juro 2a EUA", VIX: "VIX", SPX: "S&P 500", US_DE_2Y: "Spread 2a EUA−Alemanha",
    US_GB_2Y: "Spread 2a EUA−R. Unido", US_DE_10Y: "Spread 10a EUA−Alemanha", USDJPY: "USD/JPY", USOIL: "Petróleo" };
  function paintInst() {
    const a = S && S.instruments.find((x) => x.id === sel), el = $("tr-inst");
    if (!a || !el) return;
    const tech = a.tech || {}, board = (S.macro && S.macro.board) || {}, cot = (S.cot || {})[sel];
    const drivers = (DRIVERS[sel] || []).filter((k) => board[k] && board[k].v != null).map((k) => {
      const v = board[k], d = v.d5 || 0;
      return `<div class="tr-drv"><small>${esc(t(DNAME[k]))}</small><b>${nfx(v.v, k === "SPX" ? 1 : 3)}</b><em class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "+" : ""}${nfx(d, 3)} ${esc(t("em 5 d"))}</em></div>`;
    }).join("");
    const corr = ((S.macro && S.macro.corr) || {})[sel] || [];
    const cotHtml = cot ? cot.groups.map((g) => {
      const tot = g.long + g.short || 1, lp = (g.long / tot) * 100;
      return `<div class="tr-cot"><div class="tr-cot-h"><b>${esc(g.label)}</b><span>${esc(t("índice COT"))} <strong class="${g.index >= 80 ? "up" : g.index <= 20 ? "down" : ""}">${g.index}</strong>/100</span></div>
        <div class="tr-cot-bar"><i class="l" style="width:${lp}%"></i><i class="s" style="width:${100 - lp}%"></i></div>
        <div class="tr-cot-f"><span class="up">${Math.round(g.long).toLocaleString("pt-PT")} ${esc(t("comprados"))}</span><span>${esc(t("líquido"))} ${g.net >= 0 ? "+" : ""}${Math.round(g.net).toLocaleString("pt-PT")} (${g.change >= 0 ? "+" : ""}${Math.round(g.change).toLocaleString("pt-PT")} ${esc(t("na semana"))})</span><span class="down">${Math.round(g.short).toLocaleString("pt-PT")} ${esc(t("vendidos"))}</span></div>
        ${g.index >= 80 || g.index <= 20 ? `<p class="tr-cot-x">${esc(g.index >= 80 ? t("Posicionamento comprado extremo: o lado está cheio, cuidado com a reversão.") : t("Posicionamento vendido extremo: o lado está cheio, cuidado com o short squeeze."))}</p>` : ""}</div>`;
    }).join("") + `<small class="tr-cot-d">CFTC · ${esc(t("posições de"))} ${esc(cot.date)}</small>` : `<p class="tr-none">${esc(t(sel === "GER40" ? "O DAX negoceia na Eurex: a CFTC não o cobre." : "Sem dados do COT."))}</p>`;
    const ma = tech.ma || {}, rsi = tech.rsi || {}, adr = tech.adr, vp = tech.vp;
    const maHtml = ["D1", "H4", "H1"].filter((tf) => ma[tf]).map((tf) => `<span class="tr-ma ${ma[tf].stack}"><b>${tf}</b>${ma[tf].stack === "up" ? "▲" : ma[tf].stack === "down" ? "▼" : "◆"} ${esc(ma[tf].above.length === 3 ? t("acima das 3 EMA") : !ma[tf].above.length ? t("abaixo das 3 EMA") : t("acima da EMA {e}", { e: ma[tf].above.join("/") }))}</span>`).join("");
    const div = Object.entries(tech.div || {}).map(([tf, d]) => `<span class="tr-div ${d.dir}">${esc(t(d.dir === "bear" ? "Divergência de baixa" : "Divergência de alta"))} RSI ${tf} (${d.rsi[0]}→${d.rsi[1]})</span>`).join("");
    $("tr-inst-h").textContent = t("Contexto institucional de {s}", { s: sel });
    paint(el, `${S.macro && S.macro.regime ? `<p class="tr-regime">${esc(t("Regime do mercado"))}: <b>${esc(t(S.macro.regime))}</b></p>` : ""}
      <div class="tr-inst-g">
        <div><h4>${esc(t("Posicionamento dos grandes (COT)"))}</h4>${cotHtml}</div>
        <div><h4>${esc(t("O que o move"))}</h4><div class="tr-drvs">${drivers || `<p class="tr-none">—</p>`}</div>
          ${corr.length ? `<div class="tr-corr">${corr.map((c) => `<span><small>${esc(t("correlação 20 d com"))} ${esc(c.with)}</small><b class="${c.r >= 0 ? "up" : "down"}">${nfx(c.r)}</b><i style="--w:${Math.abs(c.r) * 100}%" class="${c.r >= 0 ? "pos" : "neg"}"></i></span>`).join("")}</div>` : ""}</div>
        <div><h4>${esc(t("Leitura clássica"))}</h4><div class="tr-mas">${maHtml}</div>
          <div class="tr-rsi">${Object.entries(rsi).map(([tf, v]) => `<span><small>RSI ${tf}</small><b class="${v >= 70 ? "down" : v <= 30 ? "up" : ""}">${Math.round(v)}</b><i style="--v:${v}%"></i></span>`).join("")}</div>${div}
          ${adr && adr.used != null ? `<div class="tr-adr"><small>${esc(t("Amplitude de hoje vs média diária (ADR)"))}</small><div><i style="width:${Math.min(100, adr.used * 100)}%" class="${adr.used >= .9 ? "hot" : ""}"></i></div><b>${Math.round(adr.used * 100)}%</b></div>` : ""}
          ${vp ? `<div class="tr-vp"><span><small>POC ${esc(t("ontem"))}</small><b>${num(vp.poc, a.dp)}</b></span><span><small>VAH</small><b>${num(vp.vah, a.dp)}</b></span><span><small>VAL</small><b>${num(vp.val, a.dp)}</b></span></div>` : ""}</div>
      </div>`);
  }

  // ================================================================ the meeting table
  function paintTable() {
    const ms = S.meetings || [];
    const m = (openMeeting && ms.find((x) => x.id === openMeeting)) || ms[0];
    const running = m && m.status === "running";
    const next = running ? (m.turns.length % 2 ? "twoface" : "penguin") : null;
    const turns = m ? m.turns.map((x) => bubble(x)).join("") + (running ? `<div class="tr-say ${next} typing"><img src="${portrait(next)}" alt=""><div><b>${esc(t(PEOPLE[next].name))}</b><p><i></i><i></i><i></i></p></div></div>` : "") : "";
    const v = m && m.verdict;
    const st = S.settings;
    paint($("tr-table"), `<div class="tr-duo">
        ${["penguin", "twoface"].map((w) => `<div class="tr-who ${w} ${next === w ? "speaking" : ""}"><img src="${portrait(w)}" alt=""><b>${esc(t(PEOPLE[w].name))}</b><small>${esc(t(PEOPLE[w].what))}</small></div>`).join(`<span class="tr-vs">vs</span>`)}
      </div>
      ${m ? `<div class="tr-mhead">${ui.tag(m.mode === "claude" ? `Claude ${m.model || ""}` : t("Reunião automática"), m.mode === "claude" ? "tr-claude" : "")}${running ? `<span class="st busy"><i></i>${esc(t("Em reunião"))}</span>` : ""}<time>${esc(fmt.day(m.at))} · ${hm(m.at)}</time></div>` : ""}
      ${m ? `<p class="tr-reason">${esc(m.reason)}</p>` : `<p class="tr-none">${esc(t("Ainda não houve reunião. Reúnem-se sozinhos antes de Londres e de Nova Iorque, antes e depois das notícias de alto impacto e quando aparece um sweep ou um setup que importa."))}</p>`}
      ${m && m.error ? `<p class="tr-err">${esc(m.error)}</p>` : ""}
      <div class="tr-talk">${turns}</div>
      ${v ? verdictCard(v) : ""}
      ${!st.claude ? `<p class="tr-hint">${icon("bot")}${esc(t("Com o Claude desligado, a reunião é escrita a partir dos números. Liga-o em cima para os dois agentes pensarem a sério."))}</p>` : ""}
      ${ms.length > 1 ? `<h3>${esc(t("Reuniões anteriores"))}</h3><ul class="tr-past">${ms.slice(0, 10).map((x) => `<li><button type="button" data-meeting="${x.id}" class="${m && x.id === m.id ? "on" : ""}"><time>${hm(x.at)}</time><span>${esc((x.verdict && x.verdict.titulo) || x.reason)}</span>${x.verdict ? `<i class="lvl l${x.verdict.importancia}">${x.verdict.importancia}</i>` : `<i class="lvl">${x.status === "running" ? "…" : "×"}</i>`}</button></li>`).join("")}</ul>` : ""}`);
    const talk = $("tr-table").querySelector(".tr-talk");
    if (talk && running) talk.scrollTop = talk.scrollHeight;
  }
  // a turn of the meeting: what was said, the trades it booked (or the Hub refused), what it closed, the sources read
  function bubble(x) {
    const { who, text, at } = x, byId = (id) => (S.trades || []).find((tr) => tr.id === id);
    const chips = (x.trades || []).map(byId).filter(Boolean).map((tr) => tradeChip(tr)).join("") + (x.closed || []).map(byId).filter(Boolean).map((tr) => `<span class="tr-chip closed">${esc(t("fechou"))} ${esc(tr.symbol)} ${tr.r != null ? rfmt(tr.r) : ""}</span>`).join("");
    const src = (x.sources || []).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("");
    return `<div class="tr-say ${who}"><img src="${portrait(who)}" alt=""><div><b>${esc(t(PEOPLE[who].name))}${at ? `<time>${hm(at)}</time>` : ""}</b>${String(text).split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join("")}
      ${chips ? `<div class="tr-chips">${chips}</div>` : ""}${src ? `<div class="tr-src">${icon("doc")}${src}</div>` : ""}</div></div>`;
  }
  const rfmt = (r) => `${r >= 0 ? "+" : ""}${r.toFixed(2).replace(".", ",")}R`;
  function tradeChip(tr) {
    const dp = tr.dp != null ? tr.dp : 2;
    if (tr.status === "refused") return `<span class="tr-chip refused" title="${esc(tr.note)}">${esc(tr.symbol || "?")} ${esc(t("recusada"))}: ${esc(tr.note)}</span>`;
    return `<span class="tr-chip ${tr.dir}" title="${esc(tr.plan || tr.why || "")}">${esc(t(tr.dir === "buy" ? "Compra" : "Venda"))} ${esc(tr.symbol)} @ ${num(tr.entry, dp)} · SL ${num(tr.stop, dp)} · TP ${num(tr.tp1, dp)}${tr.tp2 ? " / " + num(tr.tp2, dp) : ""} · RR ${num(tr.rr, 1)}${tr.win_from ? ` · ${esc(t("hora ideal"))} ${hm(tr.win_from)}–${hm(tr.win_to)}` : ""}</span>${tr.plan ? `<span class="tr-chip-plan">${esc(tr.plan)}</span>` : ""}`;
  }
  function verdictCard(v) {
    return `<article class="tr-verdict l${v.importancia}">
      <header><span>${esc(t("Ata da reunião"))}</span><i class="tr-dots">${[1, 2, 3, 4, 5].map((i) => `<b class="${i <= v.importancia ? "on" : ""}"></b>`).join("")}</i>${v.alerta ? `<em>${icon("bell")}${esc(t("aviso enviado"))}</em>` : ""}</header>
      <h3>${esc(v.titulo)}</h3><p>${esc(v.resumo)}</p>
      ${(v.foco || []).map((f) => `<div class="tr-focus d-${(f.direcao || "").split(" ")[0]}" data-focus="${esc(f.simbolo)}">
        <b>${esc(f.simbolo)}</b><span class="tr-dir">${esc(t(DIR_PT[(f.direcao || "").split(" ")[0]] || f.direcao))}</span>
        <dl>${f.zona ? `<div><dt>${esc(t("Zona"))}</dt><dd>${esc(f.zona)}</dd></div>` : ""}${f.stop ? `<div><dt>${esc(t("Stop"))}</dt><dd>${esc(f.stop)}</dd></div>` : ""}${(f.alvos || []).length ? `<div><dt>${esc(t("Alvos"))}</dt><dd>${esc(f.alvos.join(" · "))}</dd></div>` : ""}</dl>
        ${f.condicao ? `<p>${esc(f.condicao)}</p>` : ""}<i class="tr-conf" style="--c:${(f.confianca || 0) * 20}%"></i></div>`).join("")}
      ${(v.atencao || []).length ? `<ul class="tr-att">${v.atencao.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    </article>`;
  }

  // ================================================================ calendar and headlines
  function paintCal() {
    if (!S || !$("tr-cal")) return;
    const now = Date.now();
    let mark = false;
    const rows = S.calendar.map((e) => {
      const at = new Date(e.t).getTime(), mins = Math.round((at - now) / 60000);
      const soon = mins >= 0 && mins <= 60, past = mins < -2;
      let line = "";
      if (!past && !mark) { mark = true; line = `<div class="tr-nowline"><span>${esc(t("agora"))}</span></div>`; }
      const cd = soon ? `${Math.floor(mins / 60) ? Math.floor(mins / 60) + "h" : ""}${String(mins % 60).padStart(Math.floor(mins / 60) ? 2 : 1, "0")}min` : "";
      const unit = e.unit || "";
      return `${line}<div class="tr-ev i${e.imp} ${past ? "past" : ""} ${soon ? "soon" : ""}">
        <time>${new Date(e.t).toLocaleDateString("pt-PT", { weekday: "short" })} ${hm(e.t)}</time><span class="tr-ccy">${esc(e.ccy)}</span>
        <span class="tr-imp">${"<i></i>".repeat(e.imp)}</span><b title="${esc(e.title)}">${esc(t(e.pt || e.title))}</b>
        <span class="tr-fig"><em class="${e.actual != null && e.forecast != null ? (e.actual >= e.forecast ? "up" : "down") : ""}">${e.actual != null ? esc(e.actual + unit) : soon ? `<i class="tr-cd">${cd}</i>` : "—"}</em><small>${esc(t("prev."))} ${e.forecast != null ? esc(e.forecast + unit) : "—"} · ${esc(t("ant."))} ${e.previous != null ? esc(e.previous + unit) : "—"}</small></span></div>`;
    }).join("");
    paint($("tr-cal"), rows || `<p class="tr-none">${esc(t("Calendário vazio."))}</p>`);
  }
  function paintNews() {
    paint($("tr-news"), S.news.map((n) => `<a class="tr-headline ${n.urgent ? "urgent" : ""}" href="${esc(n.url)}" target="_blank" rel="noopener">
      <time>${ago(n.t)}</time><span>${esc(n.title)}</span><small>${esc(n.source)}${n.for.map((x) => `<i>${esc(x)}</i>`).join("")}</small></a>`).join("") || `<p class="tr-none">${esc(t("Sem manchetes."))}</p>`);
  }

  // ================================================================ the chart
  async function loadChart(fresh) {
    const id = sel, frame = tf;
    if (fresh) { chartData = null; const w = $("tr-wait"); if (w) w.hidden = false; drawMain(); }
    try {
      const d = await api(`/api/trading-room/chart?id=${encodeURIComponent(id)}&tf=${frame}`);
      if (id !== sel || frame !== tf) return;
      chartData = d; chartAt = Date.now();
      const w = $("tr-wait"); if (w) w.hidden = true;
      drawMain();
    } catch (e) { const w = $("tr-wait"); if (w) { w.hidden = false; w.textContent = String(e.message || e); } }
  }
  function drawMain() { const c = $("tr-chart"); if (c && chartData) drawChart(c, chartData, view, { layers, hover }); else if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height); }

  function bindChart(c) {
    const at = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.onpointerdown = (e) => { drag = { x: e.clientX, off: view.off }; c.setPointerCapture(e.pointerId); };
    c.onpointermove = (e) => {
      if (drag && chartData) {
        const per = (c.clientWidth - 70) / (view.n + 8);
        view.off = Math.max(0, Math.min(chartData.candles.length - 20, Math.round(drag.off + (e.clientX - drag.x) / per)));
      }
      hover = at(e); drawMain(); tip();
    };
    c.onpointerup = () => { drag = null; };
    c.onpointerleave = () => { hover = null; drag = null; drawMain(); tip(); };
    c.ondblclick = () => { view = { n: 120, off: 0 }; drawMain(); };
    c.addEventListener("wheel", (e) => { e.preventDefault(); if (!chartData) return; view.n = Math.max(30, Math.min(chartData.candles.length, Math.round(view.n * (e.deltaY > 0 ? 1.12 : .89)))); drawMain(); }, { passive: false });
    new ResizeObserver(() => drawMain()).observe(c);
  }
  function tip() {
    const el = $("tr-tip"); if (!el) return;
    const k = hover && chartData && chartData._hit;
    if (!k) { el.hidden = true; return; }
    const [ts, o, h, l, cl] = k, dp = chartData.dp;
    el.hidden = false;
    el.innerHTML = `<b>${new Date(ts * 1000).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</b>
      <span>A ${num(o, dp)}</span><span>M ${num(h, dp)}</span><span>m ${num(l, dp)}</span><span class="${cl >= o ? "up" : "down"}">F ${num(cl, dp)}</span>`;
  }

  // Draws one chart. d: /api/trading-room/chart; v: { n candles shown, off from the right }; o: { layers, hover, mini, reveal }.
  function drawChart(c, d, v, o = {}) {
    const dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const L = o.layers || {}, mini = !!o.mini, dp = d.dp;
    const all = d.candles, end = all.length - (v.off || 0), n = Math.min(v.n, end), start = Math.max(0, end - n);
    const vis = all.slice(start, Math.min(end, o.reveal != null ? start + o.reveal : end));
    if (!vis.length) return;
    const AX = mini ? 0 : 66, BX = mini ? 0 : 22, PAD = mini ? 2 : 8, PW = W - AX, PH = H - BX;
    const slot = PW / (n + PAD), cw = Math.max(1, Math.min(14, slot * .68));
    let lo = Math.min(...vis.map((x) => x[3])), hi = Math.max(...vis.map((x) => x[2]));
    const s0 = L.setup && d.setups && d.setups[0];
    if (s0 && !mini) { lo = Math.min(lo, s0.stop, ...s0.targets.map((x) => x.p), s0.zone[0]); hi = Math.max(hi, s0.stop, ...s0.targets.map((x) => x.p), s0.zone[1]); }
    const pad = (hi - lo) * .08 || 1; lo -= pad; hi += pad;
    const X = (i) => (i - start + .5) * slot, Y = (p) => PH - ((p - lo) / (hi - lo)) * PH;
    const tAt = (ts) => { let a = 0, b = all.length - 1; if (ts <= all[0][0]) return 0; while (a < b) { const m = (a + b) >> 1; if (all[m][0] < ts) a = m + 1; else b = m; } return a; };
    const XT = (ts) => X(tAt(ts));
    const right = PW;
    // background: the grid and the name
    g.fillStyle = mini ? "rgba(0,0,0,0)" : "#07090c"; g.fillRect(0, 0, W, H);
    g.save(); g.font = `700 ${mini ? 120 : 64}px "Space Grotesk", system-ui`; g.fillStyle = "rgba(255,255,255,.028)"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(`${d.id}${mini ? "" : " · " + d.tf}`, PW / 2, PH / 2); g.restore();
    const step = niceStep((hi - lo) / 7);
    g.strokeStyle = "rgba(255,255,255,.045)"; g.lineWidth = 1; g.font = `500 10.5px Inter, system-ui`; g.fillStyle = "#6f7782"; g.textBaseline = "middle";
    for (let p = Math.ceil(lo / step) * step; p < hi; p += step) {
      const y = Math.round(Y(p)) + .5; g.beginPath(); g.moveTo(0, y); g.lineTo(PW, y); g.stroke();
      if (!mini) g.fillText(num(p, dp), PW + 8, y);
    }
    // killzones (intraday): London, New York AM, Asia
    if (L.kz && !mini && TF_SEC[d.tf] <= 3600) {
      const KZ = [[2, 5, "rgba(236,238,241,.05)", "Londres"], [7, 10, "rgba(236,238,241,.065)", "NY AM"], [20, 24, "rgba(236,238,241,.025)", "Ásia"]];
      let prev = null;
      vis.forEach((x, k) => {
        const h = nyHour(x[0]), z = KZ.find(([a, b]) => h >= a && h < b);
        if (z) { g.fillStyle = z[2]; g.fillRect(X(start + k) - slot / 2, 0, slot + .5, PH); if (prev !== z) { g.fillStyle = "rgba(220,228,240,.4)"; g.font = "600 9.5px Inter, system-ui"; g.textBaseline = "top"; g.fillText(z[3].toUpperCase(), X(start + k) - slot / 2 + 3, 6); } }
        prev = z;
      });
    }
    // premium / discount of the dealing range
    if (L.pd && d.range && d.range.hi && !mini) {
      const eq = (d.range.hi + d.range.lo) / 2;
      g.fillStyle = "rgba(239,111,94,.05)"; g.fillRect(0, Y(d.range.hi), PW, Y(eq) - Y(d.range.hi));
      g.fillStyle = "rgba(95,207,140,.05)"; g.fillRect(0, Y(eq), PW, Y(d.range.lo) - Y(eq));
      dashed(g, 0, Y(eq), PW, "rgba(255,255,255,.25)", [2, 4]);
      tag(g, 6, Y(eq) - 9, "EQ 50%", "rgba(255,255,255,.55)", null);
      tag(g, 6, Y(d.range.hi) + 4, t("PREMIUM"), "rgba(255,120,140,.75)", null);
      tag(g, 6, Y(d.range.lo) - 14, t("DESCONTO"), "rgba(80,230,160,.75)", null);
    }
    // fair value gaps and order blocks, from where they formed to the right edge
    const box = (x0, top, bot, fill, line, label) => {
      const y0 = Y(top), y1 = Y(bot); if (y1 < 0 || y0 > PH) return;
      g.fillStyle = fill; g.fillRect(x0, y0, right - x0, Math.max(1, y1 - y0));
      g.strokeStyle = line; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y0 + .5); g.lineTo(right, y0 + .5); g.moveTo(x0, y1 - .5); g.lineTo(right, y1 - .5); g.stroke();
      if (label && !mini) { g.font = "700 9px Inter, system-ui"; g.fillStyle = line; g.textBaseline = "bottom"; g.fillText(label, Math.max(x0, 0) + 3, y1 - 2); }
    };
    if (L.fvg) for (const f of d.fvg || []) box(Math.max(0, XT(f.t) - slot / 2), f.top, f.bot, f.dir === "up" ? "rgba(95,207,140,.11)" : "rgba(239,111,94,.11)", f.dir === "up" ? "rgba(95,207,140,.55)" : "rgba(239,111,94,.55)", "FVG");
    if (L.ob) for (const b of d.ob || []) box(Math.max(0, XT(b.t) - slot / 2), b.top, b.bot, b.dir === "up" ? "rgba(90,169,255,.12)" : "rgba(255,159,67,.12)", b.dir === "up" ? "rgba(90,169,255,.75)" : "rgba(255,159,67,.75)", "OB");
    // liquidity: equal highs/lows and swings still resting, and where they were swept
    if (L.liq) {
      for (const p of d.pools || []) {
        const x0 = XT(p.t), y = Y(p.p);
        if (y < 0 || y > PH || x0 > right) continue;
        const done = p.state === "swept" || p.state === "taken", x1 = done && p.tt ? XT(p.tt) : right;
        if (p.eq) { dashed(g, x0, y, x1, done ? "rgba(226,181,92,.35)" : "rgba(226,181,92,.85)", [5, 3]); if (!done && !mini) tag(g, x0 + 2, y + (p.kind === "BSL" ? -14 : 3), `$$$ ${p.kind === "BSL" ? "EQH" : "EQL"}`, GOLD, null); }
        else if (!done) dashed(g, x0, y, x1, "rgba(200,208,220,.28)", [1, 3]);
        if (p.state === "swept" && p.tt && !mini) sweepMark(g, XT(p.tt), Y(p.x), p.kind === "BSL");
      }
      for (const k of d.keys || []) {
        const y = Y(k.p); if (y < 0 || y > PH) continue;
        const col = k.state === "intact" ? GOLD : k.state === "swept" ? "#ff6bd5" : "rgba(160,168,180,.6)";
        dashed(g, 0, y, right, col, k.state === "intact" ? [8, 4] : [2, 4]);
        if (!mini) tag(g, right - 6, y - 8, `${k.key} · ${t(STATE_PT[k.state] || k.state)}`, col, "rgba(7,9,12,.85)", true);
        if (k.state === "swept" && k.at && !mini) sweepMark(g, XT(k.at), Y(k.x), k.above);
      }
    }
    // structure: from the swing that broke to the candle that broke it
    if (L.bos && !mini) for (const s of d.structure || []) {
      const x0 = XT(s.from), x1 = XT(s.t), y = Y(s.level); if (x1 < 0 || y < 0 || y > PH) continue;
      const col = s.dir === "up" ? UP : DOWN;
      g.strokeStyle = col; g.lineWidth = s.kind === "CHoCH" ? 1.6 : 1; g.setLineDash(s.kind === "CHoCH" ? [] : [4, 3]);
      g.beginPath(); g.moveTo(Math.max(0, x0), y + .5); g.lineTo(x1, y + .5); g.stroke(); g.setLineDash([]);
      g.font = "700 9.5px Inter, system-ui"; g.fillStyle = col; g.textAlign = "center"; g.textBaseline = s.dir === "up" ? "bottom" : "top";
      g.fillText(s.kind, (Math.max(0, x0) + x1) / 2, y + (s.dir === "up" ? -2 : 3)); g.textAlign = "left";
    }
    // the day's VWAP with its 1σ and 2σ bands, and the 9/21/50 EMA: one value per candle, null before the VWAP's anchor
    const curve = (val, col, w, dash) => {
      g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash || []); g.beginPath();
      let pen = false;
      vis.forEach((_, k) => { const p = val(start + k); if (p == null) { pen = false; return; } const y = Y(p); if (pen) g.lineTo(X(start + k), y); else g.moveTo(X(start + k), y); pen = true; });
      g.stroke(); g.setLineDash([]);
    };
    const edge = (p, text, col) => { if (p != null && Y(p) > 0 && Y(p) < PH) tag(g, right - 6, Y(p) - 7, text, col, "rgba(7,9,12,.85)", true); };
    if (L.ema && !mini && d.ema) {
      const EC = { 9: "rgba(90,169,255,.75)", 21: "rgba(226,181,92,.8)", 50: "rgba(167,123,255,.75)" };
      for (const k of [50, 21, 9]) { const arr = d.ema[k]; if (arr) { curve((i) => arr[i], EC[k], k === 21 ? 1.4 : 1); edge(arr[arr.length - 1], `EMA ${k}`, EC[k]); } }
    }
    if (L.vwap && !mini && d.vwap) {
      const vw = d.vwap, band = (m) => (i) => (vw[i] ? vw[i][0] + m * vw[i][1] : null);
      curve(band(2), "rgba(233,233,236,.22)", 1, [2, 3]); curve(band(-2), "rgba(233,233,236,.22)", 1, [2, 3]);
      curve(band(1), "rgba(233,233,236,.32)", 1, [5, 4]); curve(band(-1), "rgba(233,233,236,.32)", 1, [5, 4]);
      curve(band(0), "rgba(240,242,246,.9)", 1.6);
      const lastV = vw[vw.length - 1];
      if (lastV) { edge(lastV[0], "VWAP", "#f0f2f6"); edge(lastV[0] + 2 * lastV[1], "+2σ", "rgba(233,233,236,.55)"); edge(lastV[0] - 2 * lastV[1], "−2σ", "rgba(233,233,236,.55)"); }
    }
    // the candles
    vis.forEach((x, k) => {
      const i = start + k, cx0 = X(i), up = x[4] >= x[1], col = up ? UP : DOWN;
      g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(cx0) + .5, Y(x[2])); g.lineTo(Math.round(cx0) + .5, Y(x[3])); g.stroke();
      const yo = Y(x[1]), yc = Y(x[4]), top = Math.min(yo, yc), h = Math.max(1, Math.abs(yc - yo));
      g.fillStyle = up ? col : col; g.globalAlpha = up ? .95 : .95; g.fillRect(Math.round(cx0 - cw / 2), top, Math.max(1, Math.round(cw)), h); g.globalAlpha = 1;
    });
    // the setup: the zone, the stop, the targets
    if (s0 && !mini) {
      const x0 = Math.max(0, XT(s0.t)), sell = s0.dir === "sell";
      g.fillStyle = "rgba(90,169,255,.16)"; g.fillRect(x0, Y(s0.zone[1]), right - x0, Y(s0.zone[0]) - Y(s0.zone[1]));
      g.strokeStyle = "rgba(90,169,255,.9)"; g.strokeRect(x0 + .5, Y(s0.zone[1]) + .5, right - x0 - 1, Y(s0.zone[0]) - Y(s0.zone[1]));
      line(g, x0, Y(s0.stop), right, DOWN, 1.4); tag(g, x0 + 4, Y(s0.stop) + (sell ? -15 : 3), `SL ${num(s0.stop, dp)}`, "#fff", DOWN);
      s0.targets.forEach((tg, k) => { line(g, x0, Y(tg.p), right, UP, 1.4); tag(g, x0 + 4, Y(tg.p) + (sell ? 3 : -15), `TP${k + 1} ${num(tg.p, dp)}`, "#04130b", UP); });
      tag(g, x0 + 4, Y(s0.zone[sell ? 1 : 0]) + (sell ? -15 : 3), `${s0.grade} ${t(sell ? "VENDA" : "COMPRA")} · RR ${num(s0.rr, 1)}`, "#04101f", BLUE);
    }
    // the trades of the room on this instrument: the live ones as lines, the closed ones from entry to exit
    if (!mini && d.trades && d.trades.length) {
      const COL = { penguin: VIOLET, twoface: "#e9e9ec", model: BLUE };
      for (const tr of d.trades) {
        const col = COL[tr.agent] || "#ccc", x0 = Math.max(0, XT(Date.parse(tr.filled_at || tr.at) / 1000));
        if (tr.status === "pending" || tr.status === "open") {
          // the zone it waits in, and the ideal hour as a band (in the space to the right of the last candle when it is ahead)
          const lastT = all[all.length - 1][0], XF = (ts) => Math.min(right, ts <= lastT ? XT(ts) : X(all.length - 1) + ((ts - lastT) / TF_SEC[d.tf]) * slot);
          if (tr.zone) { g.fillStyle = tr.dir === "buy" ? "rgba(95,207,140,.10)" : "rgba(239,111,94,.10)"; g.fillRect(x0, Y(tr.zone[1]), right - x0, Y(tr.zone[0]) - Y(tr.zone[1])); }
          if (tr.win_from && tr.status === "pending") {
            const wa = XF(Date.parse(tr.win_from) / 1000), wb = XF(Date.parse(tr.win_to) / 1000);
            if (wb > wa + 1) { g.fillStyle = "rgba(226,181,92,.08)"; g.fillRect(wa, 0, wb - wa, PH); g.strokeStyle = GOLD; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(Math.round(wa) + .5, 0); g.lineTo(Math.round(wa) + .5, PH); g.stroke(); g.setLineDash([]); tag(g, wa + 3, 20, `${t("hora ideal")} ${hm(tr.win_from)}–${hm(tr.win_to)}`, GOLD, "rgba(7,9,12,.85)"); }
          }
          dashed(g, x0, Y(tr.entry), right, col, tr.status === "open" ? [] : [6, 3]);
          dashed(g, x0, Y(tr.half ? tr.entry : tr.stop), right, "rgba(239,111,94,.8)", [3, 3]);
          for (const p of [tr.tp1, tr.tp2]) if (p != null) dashed(g, x0, Y(p), right, "rgba(95,207,140,.8)", [3, 3]);
          const lr = tr.live_r != null ? ` ${rfmt(tr.live_r)}` : ` ${t("pendente")}`;
          tag(g, right - 8, Y(tr.entry) - 16, `${t(NAMES[tr.agent] || tr.agent)} · ${t(tr.dir === "buy" ? "compra" : "venda")}${lr}`, INK, col, true);
        } else if (tr.filled_at && tr.closed_at && tr.exit != null) {
          const x1 = XT(Date.parse(tr.closed_at) / 1000), win = tr.r > .05, lose = tr.r < -.05;
          g.strokeStyle = col; g.lineWidth = 1; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x0, Y(tr.entry)); g.lineTo(x1, Y(tr.exit)); g.stroke(); g.setLineDash([]);
          g.fillStyle = col; g.beginPath(); const up = tr.dir === "buy";
          g.moveTo(x0, Y(tr.entry) + (up ? 6 : -6)); g.lineTo(x0 - 5, Y(tr.entry) + (up ? 13 : -13)); g.lineTo(x0 + 5, Y(tr.entry) + (up ? 13 : -13)); g.closePath(); g.fill();
          g.fillStyle = win ? UP : lose ? DOWN : "#9aa2ad"; g.beginPath(); g.arc(x1, Y(tr.exit), 4.5, 0, Math.PI * 2); g.fill();
          tag(g, x1 + 6, Y(tr.exit) - 7, rfmt(tr.r), win ? UP : lose ? DOWN : "#cfd5dc", "rgba(7,9,12,.85)");
        }
      }
    }
    // the price now
    const last = all[Math.min(end, all.length) - 1];
    if (last && !mini) {
      const y = Y(last[4]), col = last[4] >= last[1] ? UP : DOWN;
      dashed(g, 0, y, PW, col, [2, 2]);
      g.fillStyle = col; rrect(g, PW + 2, y - 9, AX - 4, 18, 4); g.fill();
      g.fillStyle = INK; g.font = "700 11px Inter, system-ui"; g.textBaseline = "middle"; g.fillText(num(last[4], dp), PW + 7, y);
    }
    // time along the bottom
    if (!mini) {
      g.fillStyle = "#6f7782"; g.font = "500 10px Inter, system-ui"; g.textBaseline = "top";
      const every = Math.max(1, Math.ceil(90 / slot));
      vis.forEach((x, k) => { if ((start + k) % every === 0) { const dt = new Date(x[0] * 1000); g.fillText(TF_SEC[d.tf] >= 14400 ? dt.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" }) : dt.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }), X(start + k) - 14, PH + 6); } });
      g.strokeStyle = "rgba(255,255,255,.08)"; g.beginPath(); g.moveTo(PW + .5, 0); g.lineTo(PW + .5, H); g.moveTo(0, PH + .5); g.lineTo(W, PH + .5); g.stroke();
    }
    // the crosshair
    d._hit = null;
    if (o.hover && !mini && o.hover.x < PW && o.hover.y < PH) {
      const i = Math.round(o.hover.x / slot - .5) + start;
      if (i >= start && i < start + vis.length) d._hit = all[i];
      g.strokeStyle = "rgba(255,255,255,.28)"; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(Math.round(X(i)) + .5, 0); g.lineTo(Math.round(X(i)) + .5, PH); g.moveTo(0, Math.round(o.hover.y) + .5); g.lineTo(PW, Math.round(o.hover.y) + .5); g.stroke(); g.setLineDash([]);
      const p = lo + (1 - o.hover.y / PH) * (hi - lo);
      g.fillStyle = "#2a3038"; rrect(g, PW + 2, o.hover.y - 9, AX - 4, 18, 4); g.fill();
      g.fillStyle = "#fff"; g.font = "600 11px Inter, system-ui"; g.textBaseline = "middle"; g.fillText(num(p, dp), PW + 7, o.hover.y);
    }
  }
  function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
  function dashed(g, x0, y, x1, col, dash) { g.strokeStyle = col; g.lineWidth = 1; g.setLineDash(dash); g.beginPath(); g.moveTo(x0, Math.round(y) + .5); g.lineTo(x1, Math.round(y) + .5); g.stroke(); g.setLineDash([]); }
  function line(g, x0, y, x1, col, w) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, Math.round(y) + .5); g.lineTo(x1, Math.round(y) + .5); g.stroke(); }
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function tag(g, x, y, text, col, bg, alignRight) {
    g.font = "700 9.5px Inter, system-ui"; g.textBaseline = "top";
    const w = g.measureText(text).width + (bg ? 10 : 0), x0 = alignRight ? x - w : x;
    if (bg) { g.fillStyle = bg; rrect(g, x0, y, w, 15, 3); g.fill(); }
    g.fillStyle = col; g.fillText(text, x0 + (bg ? 5 : 0), y + (bg ? 3 : 0));
  }
  function sweepMark(g, x, y, above) {
    g.strokeStyle = "#ff6bd5"; g.lineWidth = 1.6; const r = 4;
    g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke();
    tag(g, x - 18, above ? y - 17 : y + 6, "SWEEP", "#ff6bd5", null);
  }
  function bars() { return `<svg viewBox="0 0 24 24"><path d="M5 4v16M5 7h-2v8h2M12 2v20M12 6h2v9h-2M19 5v15M19 9h2v6h-2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`; }

  // ================================================================ the big alert
  let alertEl = null, alertRaf = 0;
  function showAlert(a) {
    closeAlert(false);
    const dirKey = (a.dir || "").split(" ")[0];
    const sell = /venda|sell/.test(dirKey), buy = /compra|buy/.test(dirKey);
    const tone = sell ? "sell" : buy ? "buy" : "news";
    alertEl = document.createElement("div");
    alertEl.className = `tr-alert ${tone} l${a.level}`;
    alertEl.setAttribute("role", "alertdialog");
    alertEl.setAttribute("aria-label", a.title);
    const f = (a.focus || [])[0] || {};
    const tape = (S ? S.instruments : []).map((x) => `<span><b>${x.id}</b> ${num(x.price, x.dp)} <em class="${sign(x.chg)}">${pct(x.chg)}</em></span>`).join("");
    alertEl.innerHTML = `<canvas class="tr-alert-bg"></canvas><div class="tr-alert-scan"></div>
      <div class="tr-alert-led top"><div>${(tape || `<span>${esc(t("SALA DE TRADING · AMG CAPITAL"))}</span>`).repeat(4)}</div></div>
      <div class="tr-alert-card">
        <div class="tr-alert-top"><span class="tr-alert-live"><i></i>${esc(t("Sala de Trading"))}</span><span>${esc(t("Mensagem dos agentes"))}</span>
          <span class="tr-alert-lvl">${[1, 2, 3, 4, 5].map((i) => `<b class="${i <= a.level ? "on" : ""}"></b>`).join("")}</span></div>
        <div class="tr-alert-sym">${a.symbol ? `<strong>${esc(a.symbol)}</strong>` : ""}<span class="tr-alert-dir">${esc(t(DIR_PT[dirKey] || (tone === "news" ? "Atenção" : a.dir || "")))}</span></div>
        <h1>${esc(a.title)}</h1>
        <p class="tr-alert-body">${esc(a.body)}</p>
        ${f.plano ? `<p class="tr-alert-scen"><b>${esc(t("O plano"))}</b>${esc(f.plano)}</p>` : ""}
        ${f.zona || f.stop || (f.alvos || []).length ? `<div class="tr-alert-plan">
          ${f.zona ? `<div><small>${esc(t("Zona de entrada"))}</small><b>${esc(f.zona)}</b>${f.entrada ? `<em>${esc(t("entrada"))} ${esc(f.entrada)}</em>` : ""}</div>` : ""}
          ${f.stop ? `<div class="sl"><small>${esc(t("Stop"))}</small><b>${esc(f.stop)}</b></div>` : ""}
          ${(f.alvos || []).length ? `<div class="tp"><small>${esc(t("Alvos"))}</small><b>${esc(f.alvos.join(" · "))}</b></div>` : ""}
          ${f.janela ? `<div class="win"><small>${esc(t("Hora ideal da entrada"))}</small><b>${esc(f.janela.replace("-", "–"))}</b></div>` : ""}
          ${f.condicao ? `<p>${icon("alert")}<span><b>${esc(t("Gatilho"))}:</b> ${esc(f.condicao)}${f.invalida ? ` · <b>${esc(t("Cancela se"))}:</b> ${esc(f.invalida)}` : ""}</span></p>` : ""}</div>` : ""}
        <div class="tr-alert-duo">${(a.turns || []).slice(-2).map((x) => `<figure class="${x.who}"><img src="${portrait(x.who)}" alt=""><figcaption><b>${esc(t(PEOPLE[x.who] ? PEOPLE[x.who].name : x.who))}</b><span>${esc(clip(x.text, 190))}</span></figcaption></figure>`).join("")}</div>
        ${(a.attention || []).length ? `<ul class="tr-alert-att">${a.attention.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        <div class="tr-alert-acts"><button type="button" class="btn primary" data-a="open">${icon("trend")}${esc(t("Abrir a Sala de Trading"))}</button><button type="button" class="btn" data-a="ok">${esc(t("Visto"))}</button>
          <small>${esc(a.mode === "claude" ? t("Reunião do Macro e da Análise técnica (Claude)") : t("Leitura automática da sala"))} · ${hm(a.at)}${a.test ? " · " + esc(t("ensaio")) : ""}</small></div>
      </div>
      <div class="tr-alert-led bottom"><div>${(tape || "").repeat(4)}</div></div>`;
    document.body.append(alertEl);
    if (!tape) api("/api/trading-room/pulse").then((p) => {   // opened on another page: the tape from the room's pulse
      const one = (p.ticker || []).map((x) => `<span><b>${x.id}</b> ${num(x.price, x.dp)} <em class="${sign(x.chg)}">${pct(x.chg)}</em></span>`).join("");
      if (one && alertEl) alertEl.querySelectorAll(".tr-alert-led > div").forEach((d) => { d.innerHTML = one.repeat(3); });
    }).catch(() => {});
    requestAnimationFrame(() => alertEl && alertEl.classList.add("in"));
    alertEl.onclick = (e) => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      seen(a);
      if (b.dataset.a === "open") { if (a.symbol) { sel = a.symbol; localStorage.setItem("trading.sel", sel); } location.hash = "#/trading"; }
      closeAlert(true);
    };
    document.addEventListener("keydown", escClose);
    chime(a.level);
    // behind it, the chart of the instrument, drawing itself
    const c = alertEl.querySelector(".tr-alert-bg");
    if (a.symbol) api(`/api/trading-room/chart?id=${encodeURIComponent(a.symbol)}&tf=M15`).then((d) => {
      if (!alertEl || !c.isConnected) return;
      let k = 0;
      const run = () => { if (!alertEl || !c.isConnected) return; k = Math.min(100, k + 1.2); drawChart(c, d, { n: 100, off: 0 }, { mini: true, reveal: Math.round(k), layers: { fvg: 1, ob: 1, liq: 1 } }); if (k < 100) alertRaf = requestAnimationFrame(run); };
      run();
    }).catch(() => {});
    function escClose(e) { if (e.key === "Escape") { seen(a); closeAlert(true); document.removeEventListener("keydown", escClose); } }
  }
  function seen(a) { api(`/api/trading-room/alerts/${a.id}/seen`, { method: "POST" }).catch(() => {}); }
  function closeAlert(animate) {
    cancelAnimationFrame(alertRaf);
    const el = alertEl; alertEl = null;
    if (!el) return;
    if (!animate) { el.remove(); return; }
    el.classList.remove("in"); el.classList.add("out"); setTimeout(() => el.remove(), 420);
  }
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s);
  // three notes, rising for a buy or a news call, falling for a sell; louder the more it matters
  function chime(level) {
    try {
      const A = new (window.AudioContext || window.webkitAudioContext)(), now = A.currentTime;
      [523.25, 659.25, 783.99, level >= 5 ? 1046.5 : null].filter(Boolean).forEach((f, i) => {
        const o = A.createOscillator(), v = A.createGain();
        o.type = "triangle"; o.frequency.value = f; v.gain.setValueAtTime(0, now + i * .13);
        v.gain.linearRampToValueAtTime(.05 + level * .012, now + i * .13 + .02); v.gain.exponentialRampToValueAtTime(.0001, now + i * .13 + .7);
        o.connect(v).connect(A.destination); o.start(now + i * .13); o.stop(now + i * .13 + .75);
      });
      setTimeout(() => A.close(), 1600);
    } catch (e) { /* no sound here */ }
  }

  window.TradingRoom = { showAlert, drawChart };
})();
