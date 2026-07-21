// Streaming audio playback + lock-screen / notification controls via the
// Media Session API, plus shuffle/repeat queue management.

const audioEl = new Audio();
audioEl.preload = "auto";

// Only present inside the Capacitor-wrapped Android app (js/vendor/) — a
// real Android foreground service tied to media playback, which is what
// actually survives Samsung's background process killing. navigator.
// mediaSession alone (used below, unconditionally) only gets the browser's
// best-effort background exemption, which Samsung ignores regardless of
// battery-optimization settings. Harmless no-op everywhere else (the plain
// website, or if the vendor scripts ever fail to load).
function nativeMediaSession() {
  return window.Capacitor && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins.MediaSession;
}

let queue = [];
let queueIndex = -1;
let playOrder = []; // sequence of indices into `queue` — the actual play order
let orderPos = -1; // position within playOrder
let shuffleOn = false;
let repeatMode = "off"; // "off" | "all" | "one"
let playStartedAt = 0; // ms timestamp, used to guess when a downloadUrl may have expired
let currentArtBlobUrl = null; // tracks the last embedded-art blob URL so we can revoke it
let currentBlobUrl = null; // tracks the audio object URL backing audioEl.src (if any), so we can revoke it once we move off it

// Streaming URLs for the *next* track are fetched ahead of time (while the
// current one is still playing, screen presumably on) so that advancing to
// it when the current track ends needs no network wait — mobile browsers
// throttle background JS heavily once the screen locks, and a fetch that
// would normally take a few hundred ms can stall indefinitely at that point.
// The already-playing track keeps going fine either way (that's native
// audio, not JS-dependent); it's specifically the *transition* to the next
// one that this is protecting.
const prefetchedUrls = new Map(); // itemId -> streaming url
const urlPrefetchPromises = new Map(); // itemId -> in-flight/settled Promise<url>, so blob prefetch can reuse it

function prefetchDownloadUrl(item) {
  if (!item) return null;
  if (prefetchedUrls.has(item.id)) return Promise.resolve(prefetchedUrls.get(item.id));
  if (urlPrefetchPromises.has(item.id)) return urlPrefetchPromises.get(item.id);
  const promise = getDownloadUrl(item)
    .then((url) => {
      if (url) prefetchedUrls.set(item.id, url);
      return url;
    })
    .catch(() => null)
    .finally(() => urlPrefetchPromises.delete(item.id));
  urlPrefetchPromises.set(item.id, promise);
  return promise;
}

// Prefetching just the *streaming URL* above still leaves the actual next-
// track handoff dependent on opening a fresh HTTP connection and buffering
// it when .play() is called — exactly the kind of network+JS work that can
// get stuck if the screen locks right as the current track ends (mobile
// browsers exempt "audibly playing" tabs from background throttling, but
// that exemption is fragile in the brief silent gap between tracks). So we
// also pull down the *entire next track's bytes* into a Blob ahead of time,
// while the current track is still playing (screen presumably on) — the
// eventual swap then only needs a synchronous object-URL assignment, no
// network I/O, giving it the best chance of completing before/without
// hitting that freeze window. Only ever one track ahead, same scope as the
// URL prefetch above, to keep memory/bandwidth bounded.
const prefetchedBlobUrls = new Map(); // itemId -> object URL (already downloaded, not yet consumed)
let blobPrefetch = null; // { itemId, controller } for the in-flight download, if any

function revokeStaleBlobPrefetches(exceptItemId) {
  for (const [id, url] of prefetchedBlobUrls) {
    if (id !== exceptItemId) {
      URL.revokeObjectURL(url);
      prefetchedBlobUrls.delete(id);
    }
  }
}

function prefetchNextTrackBlob(item) {
  if (!item || prefetchedBlobUrls.has(item.id)) return;
  if (blobPrefetch && blobPrefetch.itemId === item.id) return;
  // Respect an explicit data-saver signal — this trades bandwidth for
  // reliability, which isn't the right call for someone who's opted into
  // saving data. (Network Information API isn't universal; feature-detect.)
  if (navigator.connection && navigator.connection.saveData) return;

  revokeStaleBlobPrefetches(item.id);
  if (blobPrefetch) blobPrefetch.controller.abort();

  const controller = new AbortController();
  const entry = { itemId: item.id, controller };
  blobPrefetch = entry;

  prefetchDownloadUrl(item)
    .then((url) => {
      if (!url || controller.signal.aborted) return null;
      return fetch(url, { signal: controller.signal }).then((res) => (res.ok ? res.blob() : null));
    })
    .then((blob) => {
      if (blob && !controller.signal.aborted) {
        prefetchedBlobUrls.set(item.id, URL.createObjectURL(blob));
      }
    })
    .catch(() => {}) // aborted or network failure — falls back to streaming the URL like before
    .finally(() => {
      if (blobPrefetch === entry) blobPrefetch = null;
    });
}

// ---------- Remembering what was playing across app restarts ----------
const PLAYBACK_STATE_KEY = "lastPlaybackState";
let pendingResumeIndex = -1; // queueIndex a restored position applies to
let pendingResumePosition = 0;
let hasPendingResume = false;
let lastStateSaveAt = 0;

// Uses the same slim shape as the library cache (id/name/audio only) — the
// queue can be a whole folder or search result, and saving the raw Graph
// items (with their long download URLs etc.) on every pause/tick would risk
// the same localStorage-quota problem we already hit with the library cache.
function savePlaybackState() {
  const item = queue[queueIndex];
  if (!item) return;
  try {
    localStorage.setItem(
      PLAYBACK_STATE_KEY,
      JSON.stringify({
        queue: queue.map(slimTrack),
        queueIndex,
        position: audioEl.currentTime || 0,
        shuffleOn,
        repeatMode,
      })
    );
  } catch (err) {
    console.warn("Couldn't save playback state", err);
  }
}

// Restores queue/position state only — does NOT fetch a download URL or
// start audio, so reopening the app doesn't use data until you actually tap
// play. Returns the track to display, or null if there's nothing saved.
function restorePlaybackState() {
  try {
    const raw = localStorage.getItem(PLAYBACK_STATE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (!Array.isArray(state.queue) || !state.queue.length) return null;
    if (state.queueIndex < 0 || state.queueIndex >= state.queue.length) return null;

    queue = state.queue;
    queueIndex = state.queueIndex;
    shuffleOn = !!state.shuffleOn;
    repeatMode = state.repeatMode || "off";
    buildOrder(queueIndex);
    pendingResumeIndex = queueIndex;
    pendingResumePosition = state.position || 0;
    hasPendingResume = true;
    return queue[queueIndex];
  } catch (err) {
    console.warn("Couldn't restore playback state", err);
    return null;
  }
}

const player = {
  onTrackChange: null, // callback(item) set by app.js
  onPlayStateChange: null, // callback(isPlaying) set by app.js
  onTimeUpdate: null, // callback(currentTime, duration) set by app.js
  onStatus: null, // callback(message) set by app.js, used for loading/error feedback
  onShuffleRepeatChange: null, // callback(shuffleOn, repeatMode) set by app.js
  onRealTags: null, // callback({artist, album, title}) set by app.js — real ID3 data for the current track
};

const MEDIA_ERROR_NAMES = {
  1: "aborted",
  2: "network error",
  3: "decode error (unsupported format?)",
  4: "source not supported",
};

function buildOrder(startIndex) {
  const indices = queue.map((_, i) => i);
  if (shuffleOn) {
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const pos = indices.indexOf(startIndex);
    if (pos > 0) {
      indices.splice(pos, 1);
      indices.unshift(startIndex);
    }
  }
  playOrder = indices;
  orderPos = playOrder.indexOf(startIndex);
}

// items: array of track objects. startIndex: which one to start playing.
function setQueue(items, startIndex) {
  queue = items;
  queueIndex = startIndex;
  buildOrder(startIndex);
}

function toggleShuffle() {
  shuffleOn = !shuffleOn;
  buildOrder(queueIndex);
  player.onShuffleRepeatChange && player.onShuffleRepeatChange(shuffleOn, repeatMode);
}

function cycleRepeat() {
  repeatMode = repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off";
  player.onShuffleRepeatChange && player.onShuffleRepeatChange(shuffleOn, repeatMode);
}

async function playCurrent() {
  const item = queue[queueIndex];
  if (!item) return;

  // Only apply a restored position if we're playing the exact track it was
  // saved for — tapping next/previous or a different song before ever
  // resuming should just start that track at 0, not seek to the old spot.
  const resumeAt = hasPendingResume && queueIndex === pendingResumeIndex ? pendingResumePosition : 0;
  hasPendingResume = false;

  // Kick off the cover-art fetch immediately, in parallel with the download
  // URL fetch below, instead of waiting until after playback starts — this
  // is what actually determines how fast the art appears in the UI.
  getThumbnailUrl(item.id);
  const peekPos = orderPos + 1 < playOrder.length ? orderPos + 1 : repeatMode === "all" ? 0 : -1;
  if (peekPos >= 0) {
    const nextItem = queue[playOrder[peekPos]];
    if (nextItem) {
      getThumbnailUrl(nextItem.id); // pre-warm cache so skipping feels instant
      prefetchDownloadUrl(nextItem); // see comment above prefetchedUrls — keeps auto-advance working screen-off
      prefetchNextTrackBlob(nextItem); // see comment above prefetchedBlobUrls — same goal, stronger guarantee
    }
  }

  try {
    player.onStatus && player.onStatus(`Loading "${item.name}"…`);
    let url = prefetchedBlobUrls.get(item.id);
    let usedBlobUrl = url || null;
    if (url) {
      prefetchedBlobUrls.delete(item.id);
    } else {
      url = prefetchedUrls.get(item.id);
      if (url) {
        prefetchedUrls.delete(item.id);
      } else {
        url = await getDownloadUrl(item);
      }
    }
    if (!url) throw new Error("No download URL returned by OneDrive for this file");
    audioEl.src = url;
    // Safe to revoke now — audioEl.src was reassigned above, so nothing
    // still references the previous blob (if any).
    if (currentBlobUrl && currentBlobUrl !== usedBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = usedBlobUrl;
    playStartedAt = Date.now();

    // Kick off the real-tag read (including embedded cover art) as soon as we
    // have the URL, in parallel with playback starting — only for this one
    // track, never for list rows. Not awaited here so it doesn't delay playback.
    const id3Promise = readId3Tags(url);

    await audioEl.play();
    if (resumeAt > 0) audioEl.currentTime = resumeAt;
    player.onStatus && player.onStatus("");
    updateMediaSessionMetadata(item);
    player.onTrackChange && player.onTrackChange(item);
    savePlaybackState();

    id3Promise.then((tags) => {
      if (!tags || queue[queueIndex] !== item) return;

      let pictureUrl = null;
      if (tags.picture && tags.picture.bytes && tags.picture.bytes.length > 0) {
        if (currentArtBlobUrl) URL.revokeObjectURL(currentArtBlobUrl);
        const blob = new Blob([tags.picture.bytes], { type: tags.picture.mimeType || "image/jpeg" });
        pictureUrl = URL.createObjectURL(blob);
        currentArtBlobUrl = pictureUrl;
      }

      if (!tags.artist && !tags.album && !tags.title && !pictureUrl) return;

      const title = tags.title || item.name.replace(/\.[^/.]+$/, "");
      const artist = tags.artist || (item.audio && item.audio.artist) || "OneDrive";
      const album = tags.album || (item.audio && item.audio.album) || "";

      if ("mediaSession" in navigator && navigator.mediaSession.metadata) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title,
          artist,
          album,
          artwork: pictureUrl ? [{ src: pictureUrl, sizes: "512x512", type: tags.picture.mimeType }] : [],
        });
      }
      const native = nativeMediaSession();
      // Native artwork is skipped: the plugin's Android side can't turn a
      // blob: URL into a Bitmap (only http/base64), so passing it would just
      // log a warning and no-op — title/artist/album still update fine.
      if (native) native.setMetadata({ title, artist, album, artwork: [] });
      player.onRealTags && player.onRealTags({ ...tags, pictureUrl });
    });
  } catch (err) {
    console.error("Playback failed", err);
    const detail =
      err && err.name === "NotAllowedError"
        ? "browser blocked autoplay — tap play again"
        : (err && err.message) || String(err);
    player.onStatus && player.onStatus(`Couldn't play "${item.name}": ${detail}`);
  }
}

// Jump straight to a specific track within the current queue (e.g. user
// tapped a row in a list).
async function playIndex(index) {
  if (index < 0 || index >= queue.length) return;
  queueIndex = index;
  orderPos = playOrder.indexOf(index);
  if (orderPos === -1) buildOrder(index);
  await playCurrent();
}

function playPause() {
  if (hasPendingResume) {
    playCurrent(); // nothing loaded yet after a restore — actually start playback
    return;
  }
  if (audioEl.paused) audioEl.play();
  else audioEl.pause();
}

// Moves orderPos by `delta` within playOrder, honoring repeat-all wraparound.
// Returns false if there's nowhere to go (e.g. end of queue with repeat off).
function advanceOrderPos(delta) {
  let pos = orderPos + delta;
  if (pos < 0) {
    if (repeatMode === "all") pos = playOrder.length - 1;
    else return false;
  } else if (pos >= playOrder.length) {
    if (repeatMode === "all") pos = 0;
    else return false;
  }
  orderPos = pos;
  queueIndex = playOrder[orderPos];
  return true;
}

function playNext() {
  if (advanceOrderPos(1)) playCurrent();
}

function playPrevious() {
  if (audioEl.currentTime > 3) {
    audioEl.currentTime = 0; // restart current track, like most players
  } else if (advanceOrderPos(-1)) {
    playCurrent();
  }
}

// Pure lookahead over playOrder/queue — both already sit in memory (the
// queue was built from a folder/search/playlist that's already loaded, and
// shuffle order is computed once by buildOrder), so this is just array
// indexing with no network call and no measurable cost either way.
function getUpcomingTracks(maxCount) {
  if (repeatMode === "one") {
    const current = queue[queueIndex];
    return current ? [current] : [];
  }
  const upcoming = [];
  const limit = Math.min(maxCount, playOrder.length - 1);
  let pos = orderPos;
  for (let i = 0; i < limit; i++) {
    pos++;
    if (pos >= playOrder.length) {
      if (repeatMode === "all") pos = 0;
      else break;
    }
    upcoming.push(queue[playOrder[pos]]);
  }
  return upcoming;
}

function seekTo(seconds) {
  audioEl.currentTime = seconds;
}

// Clears all in-memory playback state — used on sign-out so the mini-player
// and queue don't keep showing the previous session's (or previous account's)
// track through a sign-out/sign-in cycle. Storage-level state (lastPlaybackState)
// is cleared separately by the caller; this only handles the live runtime state.
function resetPlayer() {
  audioEl.pause();
  audioEl.removeAttribute("src");
  audioEl.load();
  queue = [];
  queueIndex = -1;
  playOrder = [];
  orderPos = -1;
  hasPendingResume = false;
  pendingResumeIndex = -1;
  pendingResumePosition = 0;
  if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
  currentBlobUrl = null;
  if (currentArtBlobUrl) URL.revokeObjectURL(currentArtBlobUrl);
  currentArtBlobUrl = null;
  for (const url of prefetchedBlobUrls.values()) URL.revokeObjectURL(url);
  prefetchedBlobUrls.clear();
  prefetchedUrls.clear();
  urlPrefetchPromises.clear();
  if (blobPrefetch) blobPrefetch.controller.abort();
  blobPrefetch = null;
}

// If a downloadUrl (valid ~1hr) expired mid-playback, refetch it and resume
// from the same position instead of just failing.
audioEl.addEventListener("error", async () => {
  const item = queue[queueIndex];
  if (!item) return;
  const elapsedMs = Date.now() - playStartedAt;
  if (elapsedMs > 50 * 60 * 1000) {
    const resumeAt = audioEl.currentTime;
    try {
      const freshUrl = await refreshDownloadUrl(item.id);
      audioEl.src = freshUrl;
      audioEl.currentTime = resumeAt;
      playStartedAt = Date.now();
      await audioEl.play();
    } catch (err) {
      console.error("Failed to refresh expired stream URL", err);
      player.onStatus && player.onStatus(`Stream link expired and refresh failed: ${err.message || err}`);
    }
  } else {
    const name = MEDIA_ERROR_NAMES[audioEl.error && audioEl.error.code] || "unknown error";
    console.error("Audio element error", audioEl.error);
    player.onStatus && player.onStatus(`Playback error (${name}) for "${item.name}"`);
  }
});

audioEl.addEventListener("play", () => {
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
  nativeMediaSession() && nativeMediaSession().setPlaybackState({ playbackState: "playing" });
  player.onPlayStateChange && player.onPlayStateChange(true);
});
audioEl.addEventListener("pause", () => {
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  // Also fires on natural track-end (the spec fires "pause" just before
  // "ended") — capacitor.config.json sets foregroundService: "always" so
  // this does NOT tear down the Android foreground service the way the
  // plugin's default "only during playback" mode would; it only updates the
  // notification's play/pause icon.
  nativeMediaSession() && nativeMediaSession().setPlaybackState({ playbackState: "paused" });
  player.onPlayStateChange && player.onPlayStateChange(false);
  savePlaybackState();
});
audioEl.addEventListener("ended", () => {
  if (repeatMode === "one") {
    audioEl.currentTime = 0;
    audioEl.play();
    return;
  }
  playNext();
});
audioEl.addEventListener("timeupdate", () => {
  player.onTimeUpdate && player.onTimeUpdate(audioEl.currentTime, audioEl.duration || 0);
  // Throttled periodic save so an abrupt kill (not a clean pause) still
  // leaves a reasonably fresh resume position, without writing on every tick.
  const now = Date.now();
  if (now - lastStateSaveAt > 15000) {
    lastStateSaveAt = now;
    savePlaybackState();
  }
});

// Mobile browsers often don't fire a clean pause/beforeunload when a tab is
// backgrounded or killed — this is the more reliable "about to lose it" signal.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") savePlaybackState();
});

function updateMediaSessionMetadata(item) {
  const title = item.name.replace(/\.[^/.]+$/, "");
  const artist = (item.audio && item.audio.artist) || "OneDrive";
  const album = (item.audio && item.audio.album) || "";

  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album });
    navigator.mediaSession.setActionHandler("play", () => audioEl.play());
    navigator.mediaSession.setActionHandler("pause", () => audioEl.pause());
    navigator.mediaSession.setActionHandler("previoustrack", playPrevious);
    navigator.mediaSession.setActionHandler("nexttrack", playNext);
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime != null) seekTo(details.seekTime);
    });
  }

  const native = nativeMediaSession();
  if (native) {
    native.setMetadata({ title, artist, album, artwork: [] });
    native.setActionHandler({ action: "play" }, () => audioEl.play());
    native.setActionHandler({ action: "pause" }, () => audioEl.pause());
    native.setActionHandler({ action: "previoustrack" }, playPrevious);
    native.setActionHandler({ action: "nexttrack" }, playNext);
    native.setActionHandler({ action: "seekto" }, (details) => {
      if (details.seekTime != null) seekTo(details.seekTime);
    });
  }
}
