// Sinal na notícia: the big BUY / SELL over any page of the Hub the second a US figure is out (impacto alto, or an ensaio).
// Tiny and always loaded: it only asks the Hub on each "sinal" live event (backend/app/tradingroom/sinal.py); the drawing is
// sinal.js, fetched only then. Off on this browser with «Aviso em todo o Hub» on the page; never over the page itself.
(function () {
  let shown = "", busy = false, aviso = "";
  const PRE = 900;   // the warning opens 15 minutes before a red US figure
  const NAMES = { GOLD: "Ouro", EURUSD: "EUR/USD", GER40: "GER40", GBPUSD: "GBP/USD", AUDUSD: "AUD/USD", NZDUSD: "NZD/USD", USDJPY: "USD/JPY", USDCAD: "USD/CAD", USDCHF: "USD/CHF" };
  const VANTAGE = { GOLD: "XAUUSD", EURUSD: "EURUSD", GER40: "GER40", GBPUSD: "GBPUSD", AUDUSD: "AUDUSD", NZDUSD: "NZDUSD", USDJPY: "USDJPY", USDCAD: "USDCAD", USDCHF: "USDCHF" };
  // The chart of that asset on Vantage's own feed (TradingView; the symbols exist as VANTAGE:*). Never an order: entry is by hand.
  window.vantageBtn = (s, cls = "btn") => (VANTAGE[s] ? `<a class="${cls}" href="https://www.tradingview.com/chart/?symbol=VANTAGE:${VANTAGE[s]}" target="_blank" rel="noopener">${esc(t("Abrir no Vantage"))} · ${esc(t(NAMES[s]))}</a>` : "");
  const closed = (id) => { try { return (localStorage.getItem("sn-closed") || "").split(",").includes(id); } catch (e) { return false; } };
  window.sinalClosed = closed;
  window.sinalClose = (id) => { try { localStorage.setItem("sn-closed", [...(localStorage.getItem("sn-closed") || "").split(","), id].slice(-20).join(",")); } catch (e) { /* private window */ } };
  const isOff = () => { try { return localStorage.getItem("sn-aviso") === "0"; } catch (e) { return false; } };
  const money = (v) => (v ? String(v).replace(".", ",") : "—");

  // The red US figure about to come out, if any: the one being watched, or the next on the calendar.
  function upcoming(S, now = Date.now() / 1000) {
    const w = S && S.watch && !S.watch.test ? S.watch : null, P = w && w.parts.find((p) => p.cur === "USD");
    if (P) return P.state === "done" ? null : { t: w.t, cur: "USD", ...P.items[0], assets: P.assets };
    const n = ((S && S.next) || []).find((x) => x.cur === "USD" && x.t > now && x.t - now <= PRE);
    return n ? { ...n, actual: "" } : null;
  }
  function stopAviso() {
    document.querySelector(".sn-av")?.remove();
    aviso = "";
  }
  function drawAviso(n, id) {
    const old = document.querySelector(".sn-av");
    if (old) { old.querySelector("[data-real]").textContent = money(n.actual); return; }
    const ov = document.createElement("div");
    ov.className = "sn-ov sn-av";
    const at = new Date(n.t * 1000), date = at.toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "2-digit" }), hour = at.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
    ov.innerHTML = `<div class="sn-stage sn-ov-box is-flat" role="alertdialog" aria-modal="true" aria-label="${esc(t("Notícia a sair"))}">
      <button type="button" class="sn-x" data-x aria-label="${esc(t("Fechar"))}">×</button>
      <div class="sn-meta"><span class="sn-imp high"><i></i>${esc(t("impacto alto"))}</span></div>
      <h2 class="sn-name"><span class="sn-cur">${esc(n.cur)}</span> ${esc(n.label)}</h2>
      <p class="sn-av-clock">${esc(date)} · ${esc(hour)}</p>
      <dl class="sn-av-nums"><div><dt>${esc(t("Previsto"))}</dt><dd>${esc(money(n.forecast))}</dd></div><div><dt>${esc(t("Anterior"))}</dt><dd>${esc(money(n.previous))}</dd></div>
        <div><dt>${esc(t("Real"))}</dt><dd data-real>${esc(money(n.actual))}</dd></div></dl>
      <div class="sn-ov-btns">${n.assets.slice(0, 3).map((s, i) => window.vantageBtn(s, i ? "btn" : "btn primary")).join("")}</div></div>`;
    const close = () => { window.sinalClose(id); stopAviso(); };
    ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest("[data-x]")) close(); });
    document.body.append(ov);
  }
  async function warn() {
    if (document.hidden || typeof token === "undefined" || !token) return;
    try {
      const n = upcoming(await api("/api/sinal")), id = n ? `av${n.t}` : "";
      if (!n || isOff() || closed(id) || location.hash.startsWith("#/sinal")) return stopAviso();
      await lazyFile("hub/sinal.css").catch(() => {});
      aviso = id;
      drawAviso(n, id);
    } catch (e) { /* the next round tries again */ }
  }
  async function check() {
    if (busy || typeof token === "undefined" || !token) return;
    busy = true;
    try {
      const a = await api("/api/sinal/alert");
      if (a && a.id !== shown) {
        shown = a.id;
        if (!isOff() && !closed(a.id) && !location.hash.startsWith("#/sinal")) {
          stopAviso();   // the figure is out: the big result takes the warning's place
          await Promise.all([lazyFile("hub/sinal.css").catch(() => {}), lazyFile("hub/sinal.js")]);
          window.Sinal.showAlert(a);
        }
      }
    } catch (e) { /* the next event tries again */ }
    busy = false;
  }
  onLive(["sinal"], () => { check(); warn(); });
  setTimeout(() => { check(); warn(); }, 2500);   // after login and the first page
  setInterval(warn, 30000);
  setInterval(() => { if (!document.hidden) check(); }, 30000);   // a refreshed page gets the result back even with no event
  document.addEventListener("visibilitychange", warn);
})();
