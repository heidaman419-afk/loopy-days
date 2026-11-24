// Loopy Days service worker: caches every app file so the app opens with no signal.
// Bump VERSION whenever any file changes; the old cache is removed on activate.

const VERSION = 'loopy-days-v2';

const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/base.css',
  './css/shell.css',
  './css/counter.css',
  './fonts/Nunito.woff2',
  './fonts/Fredoka.woff2',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './js/app.js',
  './js/db.js',
  './js/router.js',
  './js/data/projects.js',
  './js/data/counters.js',
  './js/data/timer.js',
  './js/ui/dom.js',
  './js/ui/icons.js',
  './js/ui/overlay.js',
  './js/ui/header.js',
  './js/screens/home.js',
  './js/screens/placeholder.js',
  './js/screens/counter.js',
  './js/screens/counter-sheets.js',
  './js/screens/lock.js',
  './js/screens/timer-settings.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('loopy-days-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache first (instant, works offline). Page navigations fall back to the cached app shell.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html', { cacheName: VERSION })
        .then((hit) => hit || fetch(req))
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      });
    }),
  );
});
