// Mon Classeur Pokémon: the app works offline; card scans and prices come back with the connection.
const APP = 'classeur-app-__BUILD__';
const LIB = 'classeur-lib-v1';
const DATA = 'classeur-data-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== APP && k !== LIB && k !== DATA).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin === self.location.origin && /\/vision-[0-9a-f]+\.bin$/.test(url.pathname)) {
    // card fingerprints: the file name changes when they change, so the saved copy is always right
    e.respondWith(caches.open(DATA).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); c.keys().then(ks => Promise.all(ks.filter(k => /vision-/.test(k.url)).map(k => c.delete(k)))).then(() => c.put(e.request, copy)); }
      return r;
    }))));
    return;
  }
  if (url.origin === self.location.origin) {
    // the app itself: newest version when online, saved copy when offline
    const fresh = e.request.mode === 'navigate' ? new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(e.request, { cache: 'no-cache' });
    e.respondWith(fetch(fresh).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(APP).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
    return;
  }
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    // text recognition engine and fonts: download once, then reuse
    e.respondWith(caches.open(LIB).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok || r.type === 'opaque') c.put(e.request, r.clone());
      return r;
    }))));
  }
  // TCGdex API, card scans and Cardmarket go straight to the network
});
