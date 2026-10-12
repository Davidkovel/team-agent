// Sala de Trading: the big alert, on any page of the Hub (and in the widget). The two traders of the room (the
// Pinguim and the Duas-Caras, backend/app/tradingroom/) call the partners when their meeting says something needs
// attention now. This file is tiny and always loaded: it only asks the Hub whether there is an alert for this person
// (on start and on each "trading" live event); the alert itself is drawn by trading-room.js, fetched only then.
(function () {
  let shown = 0, busy = false;
  async function check() {
    if (busy || typeof token === "undefined" || !token) return;
    busy = true;
    try {
      const a = await api("/api/trading-room/alert");
      if (a && a.id !== shown) {
        shown = a.id;
        await Promise.all([lazyFile("hub/crew-people.js"), lazyFile("hub/trading-room.css").catch(() => {}), lazyFile("hub/trading-book.css").catch(() => {}), lazyFile("hub/trading-room.js")]);
        window.TradingRoom.showAlert(a);
      }
    } catch (e) { /* the next event tries again */ }
    busy = false;
  }
  onLive(["trading"], check);
  setTimeout(check, 2500);   // after login and the first page
})();
