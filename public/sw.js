/* Flora — Service Worker (Etapa 1: app instalable + shell offline)
 *
 * Filosofía CONSERVADORA para no mostrar datos viejos:
 *  - /api/*            → SOLO red (nunca se cachea: es sesión y datos en vivo).
 *  - Terceros (Google, fuentes, tracking) → SOLO red (no cacheamos ajeno).
 *  - Navegación (HTML) → red primero, y si no hay señal, la cáscara cacheada.
 *  - Assets propios (js/css/img/fuentes locales) → cache primero, revalidando de fondo.
 *
 * La "guantera offline" (cachear el certificado y datos del socio) es la Etapa 2:
 * acá todavía NO se cachea nada de /api.
 */
const VERSION = 'flora-pwa-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

// Cáscara del portal: HTML de rutas + estáticos base. Si alguno 404ea en el deploy,
// el precache lo saltea sin romper la instalación (addAll es todo-o-nada, por eso van de a uno).
const SHELL_URLS = [
  '/socios/',
  '/socios/carta/',
  '/socios/cuenta/',
  '/socios/reprocann/',
  '/aceites/',
  '/cremas/',
  '/extracciones/',
];
const ASSET_URLS = [
  '/socios/tienda.css',
  '/socios/tienda.js',
  '/socios/icons.js',
  '/socios/bancos.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await Promise.allSettled(SHELL_URLS.map((u) => shell.add(u)));
    const assets = await caches.open(ASSETS);
    await Promise.allSettled(ASSET_URLS.map((u) => assets.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/PUT/DELETE nunca se tocan

  const url = new URL(req.url);

  // 1) Terceros (Google auth, fuentes, tracking, MP): solo red, sin cachear.
  if (!isSameOrigin(url)) return;

  // 2) API propia: SOLO red. Nada de datos/sesión en caché (eso es Etapa 2).
  if (url.pathname.startsWith('/api/')) return;

  // 3) Navegación (documentos HTML): red primero, cáscara como red de seguridad.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        return fresh;
      } catch (e) {
        const cache = await caches.open(SHELL);
        const cached = await cache.match(req, { ignoreSearch: true })
          || await cache.match('/socios/');
        return cached || Response.error();
      }
    })());
    return;
  }

  // 4) Assets propios: cache primero, revalidando de fondo (stale-while-revalidate).
  event.respondWith((async () => {
    const cache = await caches.open(ASSETS);
    const cached = await cache.match(req);
    const network = fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
        return res;
      })
      .catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
