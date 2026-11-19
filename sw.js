// Service worker: офлайн-режим.
// CACHE_VERSION при публикации подменяется на номер коммита (см. .github/workflows/pages.yml),
// поэтому каждая публикация создаёт новый кэш и телефон получает свежую версию.
// Список PRECACHE должен содержать все файлы приложения: это проверяет tests/sw.test.js.
const CACHE_VERSION = 'dev';
const CACHE_NAME = `workout-${CACHE_VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './data/exercises.json',
  './data/program.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/app.js',
  './js/db.js',
  './js/logic/backup.js',
  './js/logic/calibration.js',
  './js/logic/dates.js',
  './js/logic/equipment.js',
  './js/logic/flow.js',
  './js/logic/format.js',
  './js/logic/profile.js',
  './js/logic/program.js',
  './js/logic/progression.js',
  './js/logic/schedule.js',
  './js/logic/stats.js',
  './js/logic/workout.js',
  './js/platform.js',
  './js/store.js',
  './js/ui/active.js',
  './js/ui/charts.js',
  './js/ui/common.js',
  './js/ui/idle.js',
  './js/ui/onboarding.js',
  './js/ui/program.js',
  './js/ui/progress.js',
  './js/version.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('workout-') && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Файлы приложения: сначала кэш, при отсутствии сеть, с докладыванием в кэш.
// Запросы на другие сайты (например, YouTube) не трогаем.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    })
  );
});
