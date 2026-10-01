// Minimal service worker — just enough for "Add to Home Screen" installability.
// We deliberately do NOT cache audio or Graph API responses since this app
// is streaming-only by design (no offline playback).

const CACHE_NAME = "musicplayer-shell-v133";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/core/config.js",
  "./js/core/dom.js",
  "./js/core/errorlog.js",
  "./js/core/events.js",
  "./js/core/platform.js",
  "./js/core/playbackIntent.js",
  "./js/core/text.js",
  "./js/data/artwork.js",
  "./js/data/auth.js",
  "./js/data/graph.js",
  "./js/data/id3.js",
  "./js/data/indexKeepAlive.js",
  "./js/data/indexer.js",
  "./js/data/library.js",
  "./js/data/lyrics.js",
  "./js/data/playlists.js",
  "./js/data/textMatch.js",
  "./js/main.js",
  "./js/player/player.js",
  "./js/state/browse.js",
  "./js/ui/addToPlaylist.js",
  "./js/ui/backButton.js",
  "./js/ui/backup.js",
  "./js/ui/detailOverlay.js",
  "./js/ui/errorLogView.js",
  "./js/ui/fallbackArt.js",
  "./js/ui/folderActions.js",
  "./js/ui/folderPicker.js",
  "./js/ui/folderView.js",
  "./js/ui/intro.js",
  "./js/ui/libraryWork.js",
  "./js/ui/lyrics.js",
  "./js/ui/playerUI.js",
  "./js/ui/playlists.js",
  "./js/ui/search.js",
  "./js/ui/select.js",
  "./js/ui/settings.js",
  "./js/ui/swipe.js",
  "./js/ui/themes.js",
  "./js/ui/toast.js",
  "./js/ui/trackRow.js",
  "./js/ui/upNext.js",
  "./js/vendor/capacitor-core.js",
  "./js/vendor/capacitor-media-session.js",
  "./js/vendor/capacitor-browser.js",
  "./js/vendor/capacitor-app.js",
  "./js/vendor/capacitor-filesystem.js",
  "./js/vendor/capacitor-share.js",
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
