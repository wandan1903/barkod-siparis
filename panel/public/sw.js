// Barkod Sipariş servis çalışanı: uygulama dosyalarını saklar, internet yokken sayfaları açar.
// Veri istekleri (Supabase) burada saklanmaz; çevrimdışı satışlar uygulamanın kendi kuyruğunda bekler.
const CACHE = 'bs-shell-v1';
const PRECACHE = ['/market', '/market/satis', '/giris', '/manifest.webmanifest', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

async function networkFirst(request, fallbackUrls) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
    for (const url of fallbackUrls || []) {
      const fb = await cache.match(url);
      if (fb) return fb;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase vb. dış istekler: dokunma

  if (url.pathname.startsWith('/_next/static/') || /\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (req.mode === 'navigate') {
    const fallback = url.pathname.startsWith('/market') ? ['/market/satis', '/market'] : ['/giris'];
    event.respondWith(networkFirst(req, fallback));
    return;
  }
  // Next.js sayfa verisi (RSC) ve diğer aynı kaynaklı GET istekleri
  event.respondWith(networkFirst(req));
});
