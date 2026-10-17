// ============================================================
//  sw.js — "service worker": makes NEXUS work like a phone app
// ============================================================
//  It keeps a copy of the website files in the browser.
//  Online:  always loads the newest files (and updates the copy).
//  Offline: shows the saved copy, so the app still opens.
//  /api/... requests are never saved (your chats always come fresh).

const CACHE = "nexus-v4";   // change the number when files are added
const FILES = ["/", "/index.html", "/style.css", "/app.js", "/render.js", "/runners.js", "/exporter.js", "/notes.js", "/icon.svg", "/icon-192.png", "/icon-512.png", "/manifest.json"];

// First install: save the website files
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

// New version: delete old saved copies
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Every request: try the internet first, use the saved copy if offline
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then((saved) => saved || caches.match("/")))
  );
});
