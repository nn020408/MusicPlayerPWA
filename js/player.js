// Streaming audio playback + lock-screen / notification controls via the
// Media Session API, plus shuffle/repeat queue management.

const audioEl = new Audio();
audioEl.preload = "auto";

let queue = [];
let queueIndex = -1;
let playOrder = []; // sequence of indices into `queue` — the actual play order
let orderPos = -1; // position within playOrder
let shuffleOn = false;
let repeatMode = "off"; // "off" | "all" | "one"
let playStartedAt = 0; // ms timestamp, used to guess when a downloadUrl may have expired
let currentArtBlobUrl = null; // tracks the last embedded-art blob URL so we can revoke it

// Streaming URLs for the *next* track are fetched ahead of time (while the
// current one is still playing, screen presumably on) so that advancing to
// it when the current track ends needs no network wait — mobile browsers
// throttle background JS heavily once the screen locks, and a fetch that
// would normally take a few hundred ms can stall indefinitely at that point.
// The already-playing track keeps going fine either way (that's native
// audio, not JS-dependent); it's specifically the *transition* to the next
// one that this is protecting.
const prefetchedUrls = new Map(); // itemId -> streaming url

function prefetchDownloadUrl(item) {
  if (!item || prefetchedUrls.has(item.id)) return;
  getDownloadUrl(item)
    .then((url) => {
      if (url) prefetchedUrls.set(item.id, url);
    })
    .catch(() => {});
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
    }
  }

  try {
    player.onStatus && player.onStatus(`Loading "${item.name}"…`);
    let url = prefetchedUrls.get(item.id);
    if (url) {
      prefetchedUrls.delete(item.id);
    } else {
      url = await getDownloadUrl(item);
    }
    if (!url) throw new Error("No download URL returned by OneDrive for this file");
    audioEl.src = url;
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

      if ("mediaSession" in navigator && navigator.mediaSession.metadata) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: tags.title || item.name.replace(/\.[^/.]+$/, ""),
          artist: tags.artist || (item.audio && item.audio.artist) || "OneDrive",
          album: tags.album || (item.audio && item.audio.album) || "",
          artwork: pictureUrl ? [{ src: pictureUrl, sizes: "512x512", type: tags.picture.mimeType }] : [],
        });
      }
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

function seekTo(seconds) {
  audioEl.currentTime = seconds;
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
  player.onPlayStateChange && player.onPlayStateChange(true);
});
audioEl.addEventListener("pause", () => {
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
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
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: item.name.replace(/\.[^/.]+$/, ""),
    artist: (item.audio && item.audio.artist) || "OneDrive",
    album: (item.audio && item.audio.album) || "",
  });
  navigator.mediaSession.setActionHandler("play", () => audioEl.play());
  navigator.mediaSession.setActionHandler("pause", () => audioEl.pause());
  navigator.mediaSession.setActionHandler("previoustrack", playPrevious);
  navigator.mediaSession.setActionHandler("nexttrack", playNext);
  navigator.mediaSession.setActionHandler("seekto", (details) => {
    if (details.seekTime != null) seekTo(details.seekTime);
  });
}
