const CACHE = "football-analyzer-v16-6-20260918a";
const CORE = [
  "./", "./index.html", "./styles.css", "./app.js", "./v164-uefa-loader.js", "./v166-stable.js", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./icon-maskable-192.png",
  "./icon-maskable-512.png", "./apple-touch-icon.png", "./favicon.ico"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // V16.6: network-first for all app assets to avoid mixing old and new hotfix files.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((hit) => {
          if (hit) return hit;
          if (request.mode === "navigate") return caches.match("./index.html");
          return Promise.reject(new Error("offline"));
        })
      )
  );
});