const CACHE_NAME = 'artisan-pwa-v2'
// '/trades' was never a real route (only '/trades/queue' and
// '/trades/notes/[id]' are) — cache.addAll() fails atomically on that 404,
// which was silently breaking install. '/signals' was retired (see v3-02).
const APP_SHELL = [
  '/',
  '/dashboard',
  '/recommendations',
  '/briefing',
  '/strategy',
  '/briefings',
  '/trades/queue',
  '/offline',
  '/manifest.webmanifest',
  '/pwa-icon-192.svg',
  '/pwa-icon-512.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          return response
        })
        .catch(async () => {
          const cached = await caches.match(request)
          return cached || caches.match('/offline')
        }),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          return response
        })
        .catch(() => cached)

      return cached || networkFetch
    }),
  )
})
