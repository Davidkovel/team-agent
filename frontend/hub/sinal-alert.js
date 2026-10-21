// Sinal na notícia: the big BUY / SELL over any page of the Hub the second a US figure is out (impacto alto, or an ensaio).
// Tiny and always loaded: it only asks the Hub on each "sinal" live event (backend/app/tradingroom/sinal.py); the drawing is
// sinal.js, fetched only then. Off on this browser with «Aviso em todo o Hub» on the page; never over the page itself.
(function () {
  let shown = "", busy = false;
  async function check() {
    if (busy || typeof token === "undefined" || !token) return;
    busy = true;
    try {
      const a = await api("/api/sinal/alert");
      let off = false;
      try { off = localStorage.getItem("sn-aviso") === "0"; } catch (e) { /* private window */ }
      if (a && a.id !== shown) {
        shown = a.id;
        if (!off && !location.hash.startsWith("#/sinal")) {
          await Promise.all([lazyFile("hub/sinal.css").catch(() => {}), lazyFile("hub/sinal.js")]);
          window.Sinal.showAlert(a);
        }
      }
    } catch (e) { /* the next event tries again */ }
    busy = false;
  }
  onLive(["sinal"], check);
  setTimeout(check, 2500);   // after login and the first page
})();
