const CACHE_NAME = 'weathergpt-shell-v2';
const SHELL_FILES = [
  './',
  './index.html',
  './css/tokens.css',
  './css/base.css',
  './css/nav-hero.css',
  './css/station.css',
  './css/results.css',
  './js/utils.js',
  './js/api.js',
  './js/dropdown.js',
  './js/i18n.js',
  './js/app.js',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only handle same-origin GET requests for the app shell
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const resClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ---------------------------------------------------------------------------
// Web Push — receive server-initiated push messages
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch (_) {
    return;
  }
  const title = data.title || 'WeatherGPT Alert';
  const options = {
    body: data.body || '',
    icon: './assets/branding/logo-icon.svg',
    badge: './assets/branding/logo-icon.svg',
    data: { link: data.link || '', guid: data.guid || '' },
    tag: data.guid || 'weathergpt-push',
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ---------------------------------------------------------------------------
// Notification click — focus or open the app
// ---------------------------------------------------------------------------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || './index.html#warnings';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          if (link && client.navigate) {
            return client.navigate(link);
          }
          return;
        }
      }
      // Otherwise open a new window
      return clients.openWindow(link);
    })
  );
});
