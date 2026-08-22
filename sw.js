const CACHE = 'jade-v8';
const SHELL = [
  './',
  './index.html',
  './css/style.css?v=8',
  './js/storage.js?v=8',
  './js/app.js?v=8',
  './js/todo.js?v=8',
  './js/finance.js?v=8',
  './js/news.js?v=8',
  './js/favorites.js?v=8',
  './manifest.json?v=8',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.svg',
  'https://cdn.tailwindcss.com'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const req = e.request;

  // HTML 页面：网络优先，失败回退缓存
  if (req.mode === 'navigate' || (req.method === 'GET' && url.pathname.endsWith('.html')) || url.pathname === '/' || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return resp;
      }).catch(() => caches.match(req).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  // API 请求：网络优先
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(req).catch(() => new Response(JSON.stringify({items:[],categories:[]}), {headers:{'Content-Type':'application/json'}}))
    );
    return;
  }

  // 同源静态资源：缓存优先，网络回退
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(resp => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return resp;
      }).catch(() => cached))
    );
    return;
  }

  // 跨域资源（Tailwind CDN等）：缓存优先
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(resp => {
      if (resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return resp;
    }).catch(() => cached))
  );
});
