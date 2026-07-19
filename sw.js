// Minimal service worker — just enough for "Add to Home Screen" installability.
// We deliberately do NOT cache audio or Graph API responses since this app
// is streaming-only by design (no offline playback).

const CACHE_NAME = "musicplayer-shell-v47";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/config.js",
  "./js/auth.js",
  "./js/graph.js",
  "./js/library.js",
  "./js/playlists.js",
  "./js/id3.js",
  "./js/player.js",
  "./js/app.js",
  "./manifest.json",
  "./icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Only handle same-origin app-shell requests; Graph API, OneDrive audio
  // streams, and MSAL always go straight to the network untouched.
  if (url.origin !== self.location.origin) return;

  // Stale-while-revalidate: serve the cached file instantly if we have one
  // (no round trip before the app can paint), while fetching a fresh copy in
  // the background for next time. CACHE_NAME still gets bumped on every
  // deploy, which forces a full fresh install — this only speeds up repeat
  // opens of the same deployed version, it doesn't mask real updates.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
