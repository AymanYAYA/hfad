// Hfad service worker: lets the app open and work without internet.
// App files: network first (so updates arrive right away), saved copy when offline.
// Fonts and the Firebase library: saved copy first, refreshed in the background.
// Sign-in and database calls are never cached: they always go to the network.
const CACHE = "hfad-v15";
const APP = ["./", "index.html", "app.js", "decks.js", "phrasal.js", "cloud.js", "manifest.webmanifest", "privacy.html",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/favicon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const isLibrary = url => url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com" ||
  (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"));

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req, { cache: "no-cache" }).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
        .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html")))
    );
  } else if (isLibrary(url)) {
    e.respondWith(
      caches.match(req).then(hit => {
        const net = fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; }).catch(() => hit);
        return hit || net;
      })
    );
  }
});
