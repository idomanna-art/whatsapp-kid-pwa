const CACHE = 'wk-cache-v3';

const CORE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './data/contacts.json',
  './media/audio/ringtone.mp3',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ✅ אל תתערב בוידאו וב-Range requests (זה שובר MP4)
  if (req.headers.has('range') || url.pathname.endsWith('.mp4')) {
    return; // נותן לדפדפן להביא ישירות מהשרת
  }

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return resp;
      });
    })
  );
});
