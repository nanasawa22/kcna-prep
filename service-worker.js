/* KCNA Prep service worker — offline support.
 * Strategy:
 *   - Precache the full app shell + study content on install (works offline).
 *   - Translated study-content packs (data/i18n/<lang>/) are deliberately NOT
 *     precached: each is ~520 KB and only one language is ever needed. They are
 *     fetched on demand and then kept by the cache-first rule below, so a user
 *     who has browsed once in that language stays offline-capable.
 *   - Same-origin static assets: cache-first, fall back to network.
 *   - Navigations: network-first, fall back to cached index.html offline.
 *   - Google Fonts: stale-while-revalidate (so the app looks right offline too).
 * Bump CACHE when shipping new content so clients pick it up.
 */
const CACHE = 'kcna-prep-v1.9.0';

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './README.md',
  './CHANGELOG.md',
  './assets/css/styles.css',
  './assets/js/data-registry.js',
  './assets/js/storage.js',
  './assets/js/i18n.js',
  './assets/js/i18n-content.js',
  './assets/js/i18n/es.js',
  './assets/js/i18n/pt.js',
  './assets/js/i18n/fr.js',
  './assets/js/i18n/de.js',
  './assets/js/i18n/it.js',
  './assets/js/i18n/zh.js',
  './assets/js/i18n/ja.js',
  './assets/js/i18n/hi.js',
  './assets/js/i18n/ar.js',
  './assets/js/settings.js',
  './assets/js/study-plan.js',
  './assets/js/readiness.js',
  './assets/js/flashcards.js',
  './assets/js/exams.js',
  './assets/js/search.js',
  './assets/js/app.js',
  './assets/js/pwa.js',
  './data/fundamentals.js',
  './data/orchestration.js',
  './data/architecture.js',
  './data/delivery.js',
  './data/references.js',
  './data/glossary.js',
  './assets/icons/icon.svg',
  './assets/icons/favicon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // addAll is atomic; tolerate a missing optional file so install never wedges.
      Promise.allSettled(PRECACHE.map((u) => cache.add(u)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Cross-origin fonts: stale-while-revalidate.
  if (FONT_HOSTS.indexOf(url.hostname) >= 0) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Only handle our own origin beyond this point.
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first so updates show; offline → cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  // Static assets: cache-first.
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => hit))
  );
});

function staleWhileRevalidate(req) {
  return caches.open(CACHE).then((cache) =>
    cache.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
}
