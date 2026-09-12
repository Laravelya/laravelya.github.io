const CACHE_NAME = "eranga-cache-v6";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./app.js"
];

// 1. INSTALL
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        STATIC_ASSETS.map((url) => 
          cache.add(url).catch((err) => console.warn(`[SW] Gagal memuat aset: ${url}`, err))
        )
      );
    })
  );
  self.skipWaiting();
});

// 2. ACTIVATE
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log(`[SW] Menghapus cache lama: ${key}`);
            return caches.delete(key);
          }
          return null;
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// 3. FETCH
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  const requestUrl = new URL(e.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  const isAppShell = e.request.mode === "navigate" ||
    requestUrl.pathname.endsWith("/index.html") ||
    requestUrl.pathname.endsWith("/app.js");

  if (isAppShell) {
    e.respondWith(
      fetch(e.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, responseToCache));
          }
          return networkResponse;
        })
        .catch(() => caches.match(e.request).then((cachedResponse) => cachedResponse || caches.match("./index.html")))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        fetch(e.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(e.request, networkResponse));
            }
          })
          .catch(() => {});

        return cachedResponse;
      }

      return fetch(e.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });

          return networkResponse;
        })
        .catch(() => {
          if (e.request.mode === "navigate") {
            return caches.match("./index.html");
          }
        });
    })
  );
});
