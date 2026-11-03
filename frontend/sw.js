// The AMG app's own notifications (backend/app/webpush.py). The browser wakes this file when the Hub pushes something, even with the
// app closed; the notification shows the app's name and icon (AMG and the star) and the text of the task.
//
// The app also works with the PC off (David, 3 Nov: «quero mexer no meu widget mesmo com o PC desligado»). Every answer of the Hub
// that the phone gets is kept here: the page and its files, and each GET /api/… read. When the PC does not answer (off, Hub off,
// iPhone off the Tailscale), the app opens from what is kept and every read gets the last answer it had, marked with the
// X-AMG-Offline header (when it was kept), so the app shows «Sem PC» and what is old. Writes are not touched here: app.js keeps
// them in a queue on the phone and sends them when the PC answers again. With the PC on, everything still comes live from it;
// the kept copy is only used when the PC fails. offline.html stays for the very first open, when nothing is kept yet.
const OFFLINE = "amg-offline-1";
const SHELL = "amg-shell-1";   // the page and its files (versioned ?v=hubN, so a new version is a new entry)
const DATA = "amg-data-1";     // the last answer of each GET /api/… read
const KEEP = [OFFLINE, SHELL, DATA];
const WAIT_PAGE = 6000;        // a PC that is off can leave a request hanging; past this the kept copy is used
const WAIT_API = 9000;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(OFFLINE).then((cache) => cache.add("offline.html")).catch(() => {}));
});
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (!KEEP.includes(name)) await caches.delete(name);
  await self.clients.claim();
})()));

function timed(request, ms) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), ms);
  return fetch(request, { signal: stop.signal }).finally(() => clearTimeout(timer));
}

function stamped(res, at) {
  const headers = new Headers(res.headers);
  headers.set("X-AMG-Offline", at || "");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function keep(cacheName, key, res) {
  if (!res || !res.ok || res.type === "opaque") return;
  const headers = new Headers(res.headers);
  headers.set("X-AMG-Kept", new Date().toISOString());
  const copy = new Response(await res.clone().blob(), { status: res.status, statusText: res.statusText, headers });
  await (await caches.open(cacheName)).put(key, copy);
}

// The page: live when the PC answers, otherwise the last one the phone opened, otherwise offline.html.
async function page(request) {
  const key = new URL("./", self.registration.scope).href;
  try {
    const res = await timed(request, WAIT_PAGE);
    if (res.ok) keep(SHELL, key, res.clone()).catch(() => {});
    return res;
  } catch {
    return (await caches.match(key, { cacheName: SHELL })) || (await caches.match("offline.html")) || Response.error();
  }
}

// Files with ?v=hubN never change, so the kept one is used first; the others (logo, manifest…) are live first.
async function file(request) {
  const url = new URL(request.url);
  if (url.searchParams.has("v")) {
    const hit = await caches.match(request, { cacheName: SHELL });
    if (hit) return hit;
  }
  try {
    const res = await timed(request, WAIT_PAGE);
    keep(SHELL, request, res.clone()).catch(() => {});
    return res;
  } catch {
    return (await caches.match(request, { cacheName: SHELL, ignoreSearch: true })) || Response.error();
  }
}

// Reads of the Hub: live first; with the PC off, the last answer, marked as kept.
async function read(request) {
  try {
    const res = await timed(request, WAIT_API);
    if (res.ok) keep(DATA, request.url, res.clone()).catch(() => {});
    return res;
  } catch {
    const hit = await caches.match(request.url, { cacheName: DATA });
    if (hit) return stamped(hit, hit.headers.get("X-AMG-Kept"));
    return new Response(JSON.stringify({ detail: "Sem ligação ao PC" }), {
      status: 503, headers: { "Content-Type": "application/json", "X-AMG-Offline": "" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") return event.respondWith(page(request));
  if (url.pathname.startsWith("/ws")) return;
  if (url.pathname.startsWith("/api/")) {
    // a sign-in, a live stream or a file of a task is never served old
    if (url.pathname.startsWith("/api/auth") || url.pathname.includes("/stream") || url.pathname.includes("/blob")) return;
    return event.respondWith(read(request));
  }
  event.respondWith(file(request));
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: event.data ? event.data.text() : "" }; }
  // the same task, conversation or person coming online replaces its older notification instead of piling up under it
  event.waitUntil(self.registration.showNotification(data.title || "Agente AMG", {
    body: data.body || "",
    icon: "assets/icon-192.png",
    badge: "assets/icon-192.png",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    timestamp: Date.now(),
    data: { url: data.url || "./", kind: data.kind || "" },
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
