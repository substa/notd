const CACHE = "notd-editor-v16";
const ASSET_CACHE = "notd-graph-assets-v1";
const MAX_ASSET_ENTRIES = 100;
const MAX_ASSET_BYTES = 200 * 1024 * 1024;
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
  "./apple-touch-icon.png",
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
          keys
            .filter((key) => key !== CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);

function isGraphAsset(url) {
  return (
    (url.pathname.startsWith("/assets/") &&
      !STATIC_PATHS.has(url.pathname)) ||
    url.pathname === "/api/graph/asset"
  );
}

async function trimAssetCache(cache) {
  const requests = await cache.keys();
  const entries = await Promise.all(
    requests.map(async (request) => {
      const response = await cache.match(request);
      return {
        request,
        size: Number(response?.headers.get("Content-Length")) || 0,
      };
    }),
  );
  let bytes = entries.reduce((total, entry) => total + entry.size, 0);
  let count = entries.length;
  for (const entry of entries) {
    if (count <= MAX_ASSET_ENTRIES && bytes <= MAX_ASSET_BYTES) break;
    if (await cache.delete(entry.request)) {
      count--;
      bytes -= entry.size;
    }
  }
}

async function cacheAsset(request, response) {
  // The graph server always sets Content-Disposition on real assets. Requiring
  // it avoids caching an authentication portal returned by a reverse proxy.
  if (
    !response.ok ||
    response.status !== 200 ||
    response.redirected ||
    !response.headers.has("Content-Disposition")
  )
    return;
  try {
    const copy = response.clone();
    const cache = await caches.open(ASSET_CACHE);
    await cache.delete(request);
    await cache.put(request, copy);
    await trimAssetCache(cache);
  } catch {
    // Storage quotas are deliberately best-effort, especially on iOS.
  }
}

function assetRangeResponse(response, range) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!match) return response;
  return response.arrayBuffer().then((body) => {
    const size = body.byteLength;
    let start;
    let end;
    if (match[1]) {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    } else {
      const suffix = Number(match[2]);
      start = Math.max(0, size - suffix);
      end = size - 1;
    }
    if (
      !size ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      start >= size ||
      start > end
    )
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    const headers = new Headers(response.headers);
    headers.delete("Content-Encoding");
    headers.set("Accept-Ranges", "bytes");
    headers.set("Content-Length", String(end - start + 1));
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    return new Response(body.slice(start, end + 1), {
      status: 206,
      statusText: "Partial Content",
      headers,
    });
  });
}

async function cachedAsset(request) {
  const response = await caches.match(request, { cacheName: ASSET_CACHE });
  if (!response) return null;
  const range = request.headers.get("Range");
  return range ? assetRangeResponse(response, range) : response;
}

async function cacheCompleteAsset(request) {
  const headers = new Headers(request.headers);
  headers.delete("Range");
  const fullRequest = new Request(request, { headers });
  if (await caches.match(fullRequest, { cacheName: ASSET_CACHE })) return;
  const response = await fetch(fullRequest);
  await cacheAsset(fullRequest, response);
}

function handleGraphAsset(event) {
  const request = event.request;
  const range = request.headers.has("Range");
  const network = fetch(request);
  event.waitUntil(
    network
      .then((response) => {
        if (!response.ok) return;
        return range
          ? cacheCompleteAsset(request)
          : cacheAsset(request, response);
      })
      .catch(() => {}),
  );
  return network
    .then(async (response) => {
      if (response.ok || response.status < 500) return response;
      return (await cachedAsset(request)) || response;
    })
    .catch(async () =>
      (await cachedAsset(request)) ||
      new Response("Attachment unavailable offline", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    );
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin)
    return;
  if (isGraphAsset(url)) {
    event.respondWith(handleGraphAsset(event));
    return;
  }
  if (url.pathname.startsWith("/api/")) return;
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
