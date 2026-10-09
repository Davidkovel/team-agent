// The AMG app's own notifications (backend/app/webpush.py). The browser wakes this file when the Hub pushes something, even with the
// app closed; the notification shows the app's name and icon (AMG and the star) and the text of the task.
// The Hub is served live from the computer and nothing of it is cached. The one exception is offline.html: when opening the app
// cannot reach the computer at all (the iPhone off the Tailscale, the PC or the Hub off), the app shows that page with what to do
// instead of Safari's error, and it goes back in by itself once the Hub answers. Any answer of the Hub, errors included, goes through.
const OFFLINE = "amg-offline-1";
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(OFFLINE).then((cache) => cache.add("offline.html")).catch(() => {}));
});
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name !== OFFLINE) await caches.delete(name);
  await self.clients.claim();
})()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.match("offline.html")) || Response.error()));
});

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
