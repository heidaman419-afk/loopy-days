// Loopy Days service worker: caches every app file so the app opens with no signal.
// Bump VERSION whenever any file changes; the old cache is removed on activate.

const VERSION = 'loopy-days-v8'; // keep equal to APP_VERSION in js/version.js

const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/base.css',
  './css/shell.css',
  './css/counter.css',
  './css/settings.css',
  './css/projects.css',
  './fonts/Nunito.woff2',
  './fonts/Fredoka.woff2',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/logo-160.png',
  './js/app.js',
  './js/db.js',
  './js/router.js',
  './js/version.js',
  './js/sync/config.js',
  './js/sync/auth.js',
  './js/sync/engine.js',
  './js/sync/files.js',
  './js/ui/sync-badge.js',
  './js/data/projects.js',
  './js/data/counters.js',
  './js/data/timer.js',
  './js/data/photos.js',
  './js/ui/dom.js',
  './js/ui/icons.js',
  './js/ui/overlay.js',
  './js/ui/header.js',
  './js/ui/illustrations.js',
  './js/ui/photo-picker.js',
  './js/ui/now-bar.js',
  './js/screens/home.js',
  './js/screens/projects.js',
  './js/screens/project.js',
  './js/screens/project-form.js',
  './js/screens/tour.js',
  './js/screens/placeholder.js',
  './js/screens/counter.js',
  './js/screens/counter-sheets.js',
  './js/screens/lock.js',
  './js/screens/timer-settings.js',
  './js/screens/settings.js',
  // Feature 6: patterns
  './css/patterns.css',
  './js/data/patterns.js',
  './js/patterns/guide-math.js',
  './js/patterns/parse-guide.js',
  './js/patterns/parse-lines.js',
  './js/patterns/parse-meta.js',
  './js/patterns/pdf.js',
  './js/patterns/read-pdf.js',
  './js/patterns/sizes.js',
  './js/patterns/start-project.js',
  './js/patterns/ui.js',
  './js/screens/patterns.js',
  './js/screens/pattern.js',
  './js/screens/pattern-form.js',
  './js/screens/guide-setup.js',
  './js/screens/guide-editor.js',
  './js/screens/guide-follow.js',
  './js/screens/pdf-viewer.js',
  // Mozilla pdf.js (vendor, unmodified)
  './vendor/pdfjs/pdf.mjs',
  './vendor/pdfjs/pdf.worker.mjs',
  './vendor/pdfjs/standard_fonts/FoxitDingbats.pfb',
  './vendor/pdfjs/standard_fonts/FoxitFixed.pfb',
  './vendor/pdfjs/standard_fonts/FoxitFixedBold.pfb',
  './vendor/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb',
  './vendor/pdfjs/standard_fonts/FoxitFixedItalic.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSerif.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSerifBold.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSerifItalic.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSymbol.pfb',
  './vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf',
  './vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf',
  './vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf',
  './vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf',
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
