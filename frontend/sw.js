// The AMG app's own notifications (backend/app/webpush.py). The browser wakes this file when the Hub pushes something, even with the
// app closed; the notification shows the app's name and icon (AMG and the star) and the text of the task. Nothing else is cached or
// intercepted: the Hub is served live from the computer, so this file never touches a page load.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Agente AMG", {
    body: data.body || "",
    icon: "assets/icon-192.png",
    badge: "assets/icon-192.png",
    data: { url: data.url || "./" },
  }));
});

// A tap opens the app on that task: the window that is already open if there is one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "./", self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    for (const win of windows) {
      if ("focus" in win) { if ("navigate" in win) win.navigate(url).catch(() => {}); return win.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
