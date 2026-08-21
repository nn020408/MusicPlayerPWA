// Streaming audio playback + lock-screen / notification controls via the
// Media Session API, plus shuffle/repeat queue management.

const audioEl = new Audio();
audioEl.preload = "auto";

// ---------- Background execution keep-alive (Android only) ----------
// Android's WebView (Chromium) fully freezes a backgrounded page's JS —
// every timer, every pending fetch — once it decides the page has gone
// quiet. Actively playing audio exempts a page from that freeze, but the
// exemption lapses the instant audioEl itself pauses — which is exactly what
// happens for the few seconds a network hiccup takes to recover (see the
// "error" listener below and its retryWithBackoff loop): the app goes silent,
// gets frozen mid-retry if the screen happens to be off right then, and the
// pending setTimeout only fires once the app is foregrounded again. That
// matches "only resumes once I turn the screen back on and look at the app"
// exactly — it's page *visibility* freezing, not (just) battery optimization.
// A second, extremely quiet looping tone keeps the page genuinely producing
// audio for the whole time playback is *intended* to be on (tracked by
// wantsToPlay, not audioEl.paused, so it survives that gap), so the retry
// timers keep firing straight through it instead of freezing.
let wantsToPlay = false;
let keepAliveEl = null;

// Synthesized at runtime rather than a hardcoded blob, so what it actually
// contains is auditable: a quiet (~-55dBFS) 220Hz tone, well below the
// loudness of real music — not literal silence, since some engines treat a
// fully-silent/muted element as not "audible" and won't grant the exemption.
function makeKeepAliveDataUri() {
  const sampleRate = 8000;
  const numSamples = sampleRate; // 1 second, looped
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, numSamples * 2, true);
  const amplitude = 60; // out of 32767 (~ -55dBFS)
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(amplitude * Math.sin((2 * Math.PI * 220 * i) / sampleRate));
    view.setInt16(44 + i * 2, sample, true);
  }
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(binary);
}

if (isNative()) {
  keepAliveEl = new Audio(makeKeepAliveDataUri());
  keepAliveEl.loop = true;
}

// Drives keepAliveEl. Called with true wherever playback is started/resumed,
// and false only where playback intent genuinely ends (user pause, sign-out,
// queue exhausted) — deliberately NOT tied to audioEl's own pause/play events,
// since those also fire for the transient mid-retry pause this exists to
// survive.
function setWantsToPlay(value) {
  if (wantsToPlay === value) return;
  wantsToPlay = value;
  if (!keepAliveEl) return;
  if (value) keepAliveEl.play().catch(() => {});
  else keepAliveEl.pause();
}

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
let loadedTrackId = null; // id of the track audioEl.src actually corresponds to right now — see playPause()
// Bumped on every playCurrent() call, regardless of which track it's for.
// Comparing queue[queueIndex] === item alone breaks under Next/Previous
// ping-pong during a network retry: going B -> A -> B while B's original
// retry is still in flight makes that stale attempt's item reference match
// again, so it can win a race against the fresh attempt and land the wrong
// track's audio/metadata. A monotonically increasing token makes every
// playCurrent() call unambiguous regardless of whether the track it's for
// happens to repeat.
let playGeneration = 0;

// Set true only when playback has genuinely given up after exhausting every
// retry on a network-shaped failure (not a real "offline" event, which mobile
// connections rarely fire cleanly — see the comment on retryWithBackoff's
// caller in graph.js). The "online" listener below is what actually closes
// the loop other apps (Spotify, YouTube) have and this one didn't: without
// it, once the bounded retries above give up, nothing ever tries again on its
// own, even once the connection genuinely comes back — it just stays silent
// until you manually hit play.
let playbackNeedsNetworkRecovery = false;
window.addEventListener("online", () => {
  if (!playbackNeedsNetworkRecovery) return;
  playbackNeedsNetworkRecovery = false;
  resumePlayback();
});

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
// overridePosition lets a caller record a position other than audioEl's
// current one — playCurrent() uses this to save the *new* track immediately
// on attempt, before audioEl.src has even been reassigned to it, so
// audioEl.currentTime (still the previous track's position at that point)
// never leaks into the new track's saved entry.
function savePlaybackState(overridePosition) {
  const item = queue[queueIndex];
  if (!item) return;
  try {
    localStorage.setItem(
      PLAYBACK_STATE_KEY,
      JSON.stringify({
        queue: queue.map(slimTrack),
        queueIndex,
        position: overridePosition != null ? overridePosition : audioEl.currentTime || 0,
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
  setWantsToPlay(true);
  const myGeneration = ++playGeneration;
  const isStillCurrent = () => playGeneration === myGeneration;

  // Only apply a restored position if we're playing the exact track it was
  // saved for — tapping next/previous or a different song before ever
  // resuming should just start that track at 0, not seek to the old spot.
  const resumeAt = hasPendingResume && queueIndex === pendingResumeIndex ? pendingResumePosition : 0;
  hasPendingResume = false;

  // Recorded immediately, before we know whether this attempt actually
  // succeeds — otherwise a track that fails to load (a network drop mid
  // auto-advance, most commonly) leaves the on-disk state pointing at
  // whatever the *previous* track was, since that was the last successful
  // save. Reopening the app later would then show that stale earlier track
  // instead of the one actually current when things broke.
  savePlaybackState(resumeAt);

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

    // A prefetched URL/blob only gets used on the very first attempt — if
    // actually playing it fails, that prefetch is exactly as suspect as a
    // fresh fetch would be (both need live network to stream), so every
    // retry after that always asks OneDrive for a genuinely new one.
    let attemptNumber = 0;
    let id3Promise = null;
    await retryWithBackoff(
      async () => {
        if (!isStillCurrent()) return;
        let url = null;
        let usedBlobUrl = null;
        if (attemptNumber === 0) {
          url = prefetchedBlobUrls.get(item.id);
          if (url) {
            usedBlobUrl = url;
            prefetchedBlobUrls.delete(item.id);
          } else {
            url = prefetchedUrls.get(item.id);
            if (url) prefetchedUrls.delete(item.id);
          }
        }
        attemptNumber++;
        if (!url) url = await getDownloadUrl(item);
        if (!isStillCurrent()) return;
        if (!url) throw new Error("No download URL returned by OneDrive for this file");

        audioEl.src = url;
        // Safe to revoke now — audioEl.src was reassigned above, so nothing
        // still references the previous blob (if any).
        if (currentBlobUrl && currentBlobUrl !== usedBlobUrl) URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = usedBlobUrl;
        playStartedAt = Date.now();

        // Kick off the real-tag read (including embedded cover art) as soon
        // as we have the URL, in parallel with playback starting — only for
        // this one track, never for list rows. Not awaited here so it
        // doesn't delay playback.
        id3Promise = readId3Tags(url);

        // This is the actual step that was never retried before — a
        // prefetched URL fetched successfully while you still had signal
        // doesn't mean streaming it will succeed once you don't. .play()
        // rejecting here (e.g. Chrome's "Failed to load because no
        // supported source was found") is what auto-advancing to the next
        // track while offline actually hits, since that track's URL is
        // usually already prefetched from before the connection dropped.
        await audioEl.play();
        // Deliberately set only once .play() has actually resolved, not
        // right after audioEl.src is assigned — resumePlayback() trusts
        // loadedTrackId === current.id to mean "already good, just needs a
        // nudge" and skips the full reload (so it also skips re-firing
        // onTrackChange/updateMediaSessionMetadata below). Setting it earlier
        // meant a track whose .play() call itself failed (exactly what
        // happens retrying through a real network drop) still left
        // loadedTrackId pointing at it — so the "online" listener's
        // resumePlayback() call would see a false match, skip playCurrent()
        // entirely, and call bare audioEl.play() instead: audio could end up
        // actually resuming (if the network happened to be back by then)
        // while the mini-player/notification stayed stuck on the previous
        // track, since only playCurrent()'s own success path below updates them.
        loadedTrackId = item.id;
      },
      {
        maxAttempts: 8,
        maxDelayMs: 30000,
        onRetry: (attempt) => {
          if (isStillCurrent()) player.onStatus && player.onStatus(`Connection trouble — retrying "${item.name}" (${attempt})…`);
        },
      }
    );
    if (!isStillCurrent()) return; // you skipped to something else while this was retrying
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
    const isAutoplayBlock = err && err.name === "NotAllowedError";
    const detail = isAutoplayBlock ? "browser blocked autoplay — tap play again" : (err && err.message) || String(err);
    player.onStatus && player.onStatus(`Couldn't play "${item.name}": ${detail}`);
    setWantsToPlay(false); // every retry attempt (see retryWithBackoff above) already failed — nothing left to protect
    // An autoplay block isn't a network problem — the connection is fine, the
    // browser is just refusing to play without a fresh user gesture, and
    // auto-resuming on "online" wouldn't have one either. Every other failure
    // here (the overwhelming majority — getDownloadUrl/audioEl.play() both
    // need live network) is exactly what the "online" listener above exists
    // to recover from automatically.
    if (!isAutoplayBlock) playbackNeedsNetworkRecovery = true;
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

// Resumes playback, recovering a stuck/stale audioEl first if needed —
// loadedTrackId not matching the current queue item means audioEl doesn't
// actually hold the track we think should be playing (e.g. a skip attempted
// while offline never got past fetching the URL, or every retry above
// already gave up). Calling .play() on whatever's stale in there is a
// silent no-op either way; reloading via playCurrent() is the only thing
// that can actually recover it.
function resumePlayback() {
  setWantsToPlay(true);
  const current = queue[queueIndex];
  if (current && loadedTrackId !== current.id) {
    playCurrent();
    return;
  }
  audioEl.play();
}

// Routes every explicit "stop the music" path (in-app button, lock-screen /
// notification pause) through here so wantsToPlay always reflects real user
// intent — see the keep-alive comment above audioEl's definition for why that
// distinction (vs. just watching audioEl's own pause event) matters.
function userPause() {
  setWantsToPlay(false);
  audioEl.pause();
}

function playPause() {
  if (hasPendingResume) {
    playCurrent(); // nothing loaded yet after a restore — actually start playback
    return;
  }
  if (audioEl.paused) resumePlayback();
  else userPause();
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
  else setWantsToPlay(false); // end of queue, repeat off — nothing left to protect
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
  // Repeat-one plays only the current song again — there's nothing else
  // "up next" to show, so this is deliberately empty rather than [current].
  if (repeatMode === "one") return [];
  const currentId = queue[queueIndex] && queue[queueIndex].id;
  const upcoming = [];
  const limit = Math.min(maxCount, playOrder.length - 1);
  let pos = orderPos;
  for (let i = 0; i < limit; i++) {
    pos++;
    if (pos >= playOrder.length) {
      if (repeatMode === "all") pos = 0;
      else break;
    }
    const track = queue[playOrder[pos]];
    // Position-based skip (starting past orderPos) already excludes the
    // current track under normal play; this id check is the belt-and-
    // suspenders guard for repeat-all wraparound landing back on it.
    if (track && track.id !== currentId) upcoming.push(track);
  }
  return upcoming;
}

// Commits a drag-reorder of the "Up Next" list (app.js's enableQueueDragReorder)
// — orderedQueueIndices is the new order for everything after the current
// track. History (orderPos and anything before it) is left untouched.
// Session-only, same as shuffle order itself: never persisted.
function setUpcomingOrder(orderedQueueIndices) {
  playOrder = playOrder.slice(0, orderPos + 1).concat(orderedQueueIndices);
}

function seekTo(seconds) {
  audioEl.currentTime = seconds;
}

// Clears all in-memory playback state — used on sign-out so the mini-player
// and queue don't keep showing the previous session's (or previous account's)
// track through a sign-out/sign-in cycle. Storage-level state (lastPlaybackState)
// is cleared separately by the caller; this only handles the live runtime state.
function resetPlayer() {
  setWantsToPlay(false);
  audioEl.pause();
  audioEl.removeAttribute("src");
  audioEl.load();
  queue = [];
  queueIndex = -1;
  playOrder = [];
  orderPos = -1;
  loadedTrackId = null;
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

// Recovers from two distinct causes the same way (refetch a fresh stream URL,
// seek back to where we were, resume): a downloadUrl (valid ~1hr) expiring
// mid-playback, and a genuine network drop/bad signal — MEDIA_ERR_NETWORK.
// Retried with backoff rather than once, since a flaky signal (as opposed to
// navigator.onLine actually going false) usually needs a few attempts spread
// over time to ride out, not just one immediate retry.
audioEl.addEventListener("error", async () => {
  const item = queue[queueIndex];
  if (!item) return;
  // Same generation token playCurrent() uses — an item-reference check
  // alone would wrongly consider this recovery "still relevant" if you
  // navigate away and back to this exact track while it's retrying.
  const myGeneration = ++playGeneration;
  const isStillCurrent = () => playGeneration === myGeneration;
  const elapsedMs = Date.now() - playStartedAt;
  // MEDIA_ERR_NETWORK (2) is the "expected" code for this, but a total loss
  // of connectivity (airplane mode, not just a flaky signal) often gets
  // reported as MEDIA_ERR_SRC_NOT_SUPPORTED (4) instead — the browser can't
  // tell "genuinely bad file" from "couldn't even check because there's no
  // network," and defaults to the more generic error. Since these URLs are
  // always valid Graph-issued links (the format never actually changes
  // between plays), a code-4 error here is safe to treat as retryable too.
  const isNetworkError = audioEl.error && (audioEl.error.code === 2 || audioEl.error.code === 4);
  const resumeAt = audioEl.currentTime;

  if (elapsedMs > 50 * 60 * 1000 || isNetworkError) {
    try {
      await retryWithBackoff(
        async () => {
          if (!isStillCurrent()) return; // superseded by a newer playCurrent()/recovery — nothing left to do
          const freshUrl = await refreshDownloadUrl(item.id);
          if (!isStillCurrent()) return;
          audioEl.src = freshUrl;
          audioEl.currentTime = resumeAt;
          playStartedAt = Date.now();
          await audioEl.play();
        },
        {
          maxAttempts: 8,
          maxDelayMs: 30000,
          onRetry: (attempt) => {
            if (isStillCurrent()) player.onStatus && player.onStatus(`Connection trouble — retrying "${item.name}" (${attempt})…`);
          },
        }
      );
      if (isStillCurrent()) player.onStatus && player.onStatus("");
    } catch (err) {
      console.error("Failed to recover playback after repeated retries", err);
      if (isStillCurrent()) {
        player.onStatus && player.onStatus(`Couldn't reconnect to play "${item.name}": ${err.message || err}`);
        // Marks audioEl as no longer trustworthy for this track — resumePlayback()
        // checks this and will reload from scratch via playCurrent() instead of
        // silently no-op'ing on the still-broken element next time Play is pressed.
        loadedTrackId = null;
        setWantsToPlay(false); // genuinely given up — no point keeping the WebView pinned awake for this
        playbackNeedsNetworkRecovery = true; // this whole branch only runs for network-shaped errors — see isNetworkError above
      }
    }
  } else {
    const name = MEDIA_ERROR_NAMES[audioEl.error && audioEl.error.code] || "unknown error";
    console.error("Audio element error", audioEl.error);
    if (isStillCurrent()) {
      player.onStatus && player.onStatus(`Playback error (${name}) for "${item.name}"`);
      loadedTrackId = null;
      setWantsToPlay(false);
    }
  }
});

// Without this, a Bluetooth car head unit (AVRCP) or lock-screen widget has
// no way to know the track's duration/position — playbackState alone only
// says playing-vs-paused, not where in the song you are, so those displays
// either show a frozen 0:00 or don't update at all. Web MediaSession and the
// native plugin each have their own setPositionState; called on every
// timeupdate tick (~4x/sec) plus at play/pause/seek so the anchor is always
// fresh, matching what Chrome/Android actually use to interpolate the
// running clock between updates.
function updatePositionState() {
  if (!audioEl.duration || !isFinite(audioEl.duration)) return;
  const state = {
    duration: audioEl.duration,
    // audioEl.playbackRate is the speed multiplier for WHEN it's playing —
    // it stays 1 even while genuinely paused, since pausing doesn't change
    // that property. Passing it unconditionally is what caused the
    // notification/car display to keep extrapolating time forward while
    // paused or stopped: the OS was being told "position is still advancing
    // at 1x" regardless of actual state. 0 here means "not advancing."
    playbackRate: audioEl.paused ? 0 : audioEl.playbackRate || 1,
    position: Math.min(audioEl.currentTime, audioEl.duration),
  };
  if ("mediaSession" in navigator && "setPositionState" in navigator.mediaSession) {
    try {
      navigator.mediaSession.setPositionState(state);
    } catch {
      // Throws if position is transiently out of range (e.g. mid-src-swap) — harmless.
    }
  }
  const native = nativeMediaSession();
  if (native) native.setPositionState(state);
}

audioEl.addEventListener("play", () => {
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
  nativeMediaSession() && nativeMediaSession().setPlaybackState({ playbackState: "playing" });
  updatePositionState();
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
  updatePositionState();
  player.onPlayStateChange && player.onPlayStateChange(false);
  savePlaybackState();
});
audioEl.addEventListener("seeked", updatePositionState);
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
  updatePositionState();
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
// Belt-and-suspenders alongside visibilitychange above — Android WebViews
// don't consistently fire the same lifecycle events for every way an app can
// go away (backgrounding vs. being swiped out of Recents vs. the OS reclaiming
// it under memory pressure aren't guaranteed to all hit the same listener),
// and pagehide is the other one actually specified for "the page is going
// away," so having both covers more of that surface than either alone.
window.addEventListener("pagehide", () => savePlaybackState());

function updateMediaSessionMetadata(item) {
  const title = item.name.replace(/\.[^/.]+$/, "");
  const artist = (item.audio && item.audio.artist) || "OneDrive";
  const album = (item.audio && item.audio.album) || "";

  // "play" goes through resumePlayback() rather than audioEl.play() directly
  // — that's what checks loadedTrackId and reloads via playCurrent() if the
  // element is stale/broken (e.g. a skip attempted while offline never
  // actually got loaded), so pressing Play from the lock screen/notification
  // after reconnecting can recover a stuck track too, not just the in-app button.
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album });
    navigator.mediaSession.setActionHandler("play", resumePlayback);
    navigator.mediaSession.setActionHandler("pause", userPause);
    navigator.mediaSession.setActionHandler("previoustrack", playPrevious);
    navigator.mediaSession.setActionHandler("nexttrack", playNext);
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime != null) seekTo(details.seekTime);
    });
  }

  const native = nativeMediaSession();
  if (native) {
    native.setMetadata({ title, artist, album, artwork: [] });
    native.setActionHandler({ action: "play" }, resumePlayback);
    native.setActionHandler({ action: "pause" }, userPause);
    native.setActionHandler({ action: "previoustrack" }, playPrevious);
    native.setActionHandler({ action: "nexttrack" }, playNext);
    native.setActionHandler({ action: "seekto" }, (details) => {
      if (details.seekTime != null) seekTo(details.seekTime);
    });
  }
}
