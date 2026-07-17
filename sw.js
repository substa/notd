const CACHE = 'markd-editor-v24';
const ASSETS = ['./', './index.html', './styles.css', './theme-config.css', './graph.js', './app.js', './DOCUMENTATION.md', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then(async response => {
    if (event.request.mode === 'navigate' && !response.ok) return (await caches.match('./index.html')) || response;
    const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response;
  }).catch(() => caches.match(event.request).then(response => response || caches.match('./index.html'))));
});
