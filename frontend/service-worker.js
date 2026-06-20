// service-worker.js — cache-first for app shell, network-first for API

const CACHE_NAME   = 'loupe-v4';
const API_ORIGIN   = 'loupe-8ln5.onrender.com';

const SHELL_ASSETS = [
  './',
  './index.html',
  './photos.html',
  './notes.html',
  './css/styles.css',
  './js/app.js',
  './js/photos.js',
  './js/notes.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './images/001.png',
  './images/002.png',
  './images/003.png',
  './images/004.png',
  './images/005.png',
  './images/006.png',
];

// ── Install: pre-cache app shell ──────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: purge old caches ────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: strategy routing ───────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Network-first for API calls
  if (url.host.includes(API_ORIGIN) || url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline — backend not reachable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Cache-first for everything else (app shell)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Only cache same-origin GET responses
        if (
          event.request.method === 'GET' &&
          url.origin === self.location.origin &&
          response.status === 200
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
