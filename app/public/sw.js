const CACHE_NAME = 'atlas-pwa-v1'
// Every real page now sits behind the access-gate middleware (see
// app/src/middleware.ts) -- precaching them here at install time, before a
// session cookie can exist, would make cache.addAll() follow the redirect to
// /login and cache *that* HTML under e.g. the '/dashboard' key, silently
// corrupting the offline cache. Only unauthenticated-safe routes belong here;
// the fetch handler below already caches every real page as-you-go once the
// user is actually logged in and browsing.
const APP_SHELL = ['/offline', '/manifest.webmanifest', '/atlas-icon-192.png', '/atlas-icon-512.png']

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
