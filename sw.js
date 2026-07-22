const CACHE = "notd-editor-v9";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./theme-config.css",
  "./graph.js",
  "./app.js",
  "./docs/user-guide.md",
  "./docs/deployment.md",
  "./manifest.webmanifest",
  "./assets/icons/favicon.ico",
  "./assets/icons/favicon-16x16.png",
  "./assets/icons/favicon-32x32.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
];
const STATIC_PATHS = new Set(
  ASSETS.map((path) => new URL(path, self.location.href).pathname),
);

self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  ),
);

self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/assets/")
  )
    return;
  if (event.request.mode !== "navigate" && !STATIC_PATHS.has(url.pathname))
    return;
  event.respondWith(
    fetch(event.request)
      .then(async (response) => {
        if (!response.ok)
          return event.request.mode === "navigate"
            ? (await caches.match("./index.html")) || response
            : response;
        if (event.request.mode !== "navigate") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        event.request.mode === "navigate"
          ? caches.match("./index.html")
          : caches.match(event.request),
      ),
  );
});
