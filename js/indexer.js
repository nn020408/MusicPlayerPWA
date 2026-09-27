// Background artist indexer — tier 2 of the library (tier 1 is the fast
// filename scan in library.js). Reads each song's embedded artist tag once,
// folder by folder, and saves it on the track so it never has to be read
// again. Design rules:
//   - Visible first: the folder you're looking at is always indexed before
//     anything else, so what's on screen fills in within seconds.
//   - One folder listing (a single Graph call) hands over fresh download
//     links for every file in that folder — no per-song link lookups.
//   - Small ranged reads only (see readArtist in id3.js), several at a time.
//   - Runs while the app is on screen (or music is playing). In the
//     background Android stalls the app's network, so work simply waits and
//     carries on when you come back. A read that fails because the app went
//     to the background or the network dropped is NOT the song's fault and is
//     never counted against it.
//   - Resumable; progress saved as it goes; stoppable via Settings.

const INDEX_CONCURRENCY = 6; // in flight at once; the pacing gap below is what actually limits the rate
const INDEX_SAVE_EVERY = 100; // songs between saves of the library cache
const INDEX_NOTIFY_EVERY = 25; // songs between progress callbacks
let INDEX_RETRY_PASSES = 2; // extra passes over songs that failed, within one run
let INDEX_RETRY_PAUSE_MS = 8000;
const INDEX_MAX_STRIKES = 3; // real failures before a song is skipped until the app restarts

// Pacing. OneDrive's file server accepts a steady, moderate request rate and
// rejects bursts instantly (measured on the real library: one read a second
// all succeeded; several at once failed about a third of the time, in ~60ms).
// So instead of running flat out and stopping for minutes, reads are spaced by
// a gap that adapts, like TCP does: it eases off (doubles) as soon as reads
// start failing in a row, with only a few seconds' breather, and speeds back
// up (15% at a time) after each 30 successes, settling just under whatever
// pace the server tolerates right now.
const INDEX_BURST = 4; // failures in a row that mean "too fast"
let INDEX_COOLDOWN_MS = 4000; // short breather when that happens
const INDEX_INTERVAL_START_MS = 200; // about 5 reads a second to begin with
const INDEX_INTERVAL_FLOOR_MS = 90;
const INDEX_INTERVAL_CEIL_MS = 2500;
let indexIntervalMs = INDEX_INTERVAL_START_MS;
let indexNextSlotAt = 0;
let indexCooldownUntil = 0;
let indexConsecutiveFailures = 0;
let indexSuccessStreak = 0;
let indexThrottleNotifier = null; // set per run so easing off can be shown to the user

function noteIndexSuccess() {
  indexConsecutiveFailures = 0;
  if (++indexSuccessStreak >= 30) {
    indexSuccessStreak = 0;
    indexIntervalMs = Math.max(INDEX_INTERVAL_FLOOR_MS, Math.round(indexIntervalMs * 0.85));
  }
}

function noteIndexFailure() {
  indexSuccessStreak = 0;
  if (++indexConsecutiveFailures >= INDEX_BURST && Date.now() >= indexCooldownUntil) {
    indexIntervalMs = Math.min(INDEX_INTERVAL_CEIL_MS, indexIntervalMs * 2);
    indexCooldownUntil = Date.now() + INDEX_COOLDOWN_MS;
    indexConsecutiveFailures = 0;
    if (indexThrottleNotifier) indexThrottleNotifier(INDEX_COOLDOWN_MS);
  }
}

function isIndexThrottled() {
  return Date.now() < indexCooldownUntil;
}

// Every read waits here for its turn, so starts are never closer together than
// indexIntervalMs no matter how many reads are in flight. (JS is single
// threaded, so claiming the next slot is atomic.)
async function acquireIndexSlot(signal) {
  const now = Date.now();
  const slot = Math.max(now, indexNextSlotAt);
  indexNextSlotAt = slot + indexIntervalMs;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  return !signal.aborted;
}

async function waitIndexCooldown(signal) {
  while (!signal.aborted && isIndexThrottled()) await new Promise((r) => setTimeout(r, 250));
}

// Set (via setIndexPriorityFolder) whenever the main view opens a folder, so
// what you're looking at is read first.
let indexPriorityFolderId = null;

function setIndexPriorityFolder(folderId) {
  indexPriorityFolderId = folderId;
}

// Owned here: whether artists are being read right now, and how to stop it.
let isIndexing = false;
let indexAbortController = null;

// A scan and an indexing run are the two halves of "library work"; Settings'
// Stop button and the busy checks treat them as one.
function stopLibraryWork() {
  abortScan();
  if (indexAbortController) indexAbortController.abort();
}

function isLibraryWorkActive() {
  return isScanning || isIndexing;
}
// Songs that really failed during the CURRENT run: skipped for the rest of it
// so one bad file can't keep the loop spinning on the same folder.
let indexFailedIds = new Set();
// Real failures per song this session (id -> count). Three strikes and it's
// left alone until the app restarts; fewer and it's retried on the next run.
const indexFailCounts = new Map();

function isIndexSkipped(id) {
  return indexFailedIds.has(id) || (indexFailCounts.get(id) || 0) >= INDEX_MAX_STRIKES;
}

// Forgets failures — used by "Reset scan" and the Resume button, where every
// song deserves a fresh attempt.
function resetIndexState() {
  indexFailedIds = new Set();
  indexFailCounts.clear();
}

function indexCounts() {
  let done = 0;
  for (const t of libraryTracks) if (t.indexed) done++;
  return { done, total: libraryTracks.length };
}

// Indexing pauses while the app is in the background AND nothing is playing:
// Android stalls the app's network then anyway, and there's no reason to
// spend battery/data unseen. While music plays with the screen off, the
// playback keep-alive (player.js) is already keeping the app running, so
// indexing carries on too. wantsToPlay is player.js's "playback is intended" flag.
// The Android foreground service (indexKeepAlive.js) keeps the network and
// timers alive with the screen off, so with it running, being in the
// background is no longer a reason to wait.
function backgroundedAndSilent() {
  if (isIndexKeepAliveActive()) return false;
  const playing = typeof wantsToPlay !== "undefined" && wantsToPlay;
  return document.hidden && !playing;
}

function isOffline() {
  return navigator.onLine === false;
}

// Resolves when `blocked()` is false (or the run is stopped). Rechecks when
// `event` fires on `target` and every 2s, which also catches music starting
// while the screen is already off.
function waitWhile(blocked, signal, target, event) {
  if (!blocked()) return Promise.resolve();
  return new Promise((resolve) => {
    let timer = null;
    const finish = () => {
      if (!signal.aborted && blocked()) return;
      clearInterval(timer);
      target.removeEventListener(event, finish);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    timer = setInterval(finish, 2000);
    target.addEventListener(event, finish);
    signal.addEventListener("abort", finish);
  });
}

function waitUntilVisible(signal) {
  return waitWhile(backgroundedAndSilent, signal, document, "visibilitychange");
}

function waitUntilOnline(signal) {
  return waitWhile(isOffline, signal, typeof window !== "undefined" ? window : document, "online");
}

// The folder to index next: the one on screen if it still has work, else the
// first folder that does. Recomputed per folder (cheap) so navigating
// somewhere else re-prioritises immediately.
function pickNextIndexFolder() {
  const pending = new Map();
  for (const t of libraryTracks) {
    if (t.indexed || !t.folderId || isIndexSkipped(t.id)) continue;
    pending.set(t.folderId, (pending.get(t.folderId) || 0) + 1);
  }
  if (indexPriorityFolderId && pending.has(indexPriorityFolderId)) return indexPriorityFolderId;
  return pending.size ? pending.keys().next().value : null;
}

function applyIndexedArtist(track, artist) {
  track.indexed = true;
  if (artist) track.audio = { artist };
  track._searchText = buildSearchText(track.name, artist);
  invalidateArtistsCache();
}

async function indexOneFolder(folderId, signal, onSongDone) {
  let listing;
  try {
    listing = await retryWithBackoff(() => listFolder(folderId, { priority: "low" }), { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 6000 });
  } catch {
    // Couldn't even list the folder. If that's because we went to the
    // background or lost the network, just try this folder again later.
    if (signal.aborted || backgroundedAndSilent() || isOffline()) return;
    for (const t of libraryTracks) if (t.folderId === folderId) indexFailedIds.add(t.id);
    return;
  }
  // Fresh download links for the whole folder from one request.
  const urlById = new Map(listing.tracks.map((r) => [r.id, r["@microsoft.graph.downloadUrl"]]));
  const todo = libraryTracks.filter((t) => t.folderId === folderId && !t.indexed && !isIndexSkipped(t.id));

  await runWithConcurrency(INDEX_CONCURRENCY, todo, async (track) => {
    if (signal.aborted) return [];
    // Don't START a read the OS is about to stall (this used to be checked
    // only between folders, so a whole folder's worth of reads would launch
    // after you left the app, time out, and be wrongly marked as failed).
    await waitUntilVisible(signal);
    await waitUntilOnline(signal);
    if (signal.aborted) return [];

    let url = urlById.get(track.id);
    let needFreshUrl = !url;
    let interrupted = false; // the app went to the background / offline mid-read
    try {
      const artist = await retryWithBackoff(
        async () => {
          if (signal.aborted) return undefined; // not an error: just stop quietly
          // Wait for everything that can stall a read: the app being on
          // screen, the network, the breather, and this read's turn in the
          // pacing queue. The turn can take a while, so the app may have gone
          // to the background while we waited for it — check again after, and
          // start over if so, rather than launching a read the OS will stall.
          for (;;) {
            if (backgroundedAndSilent() || isOffline()) {
              interrupted = true;
              await waitUntilVisible(signal);
              await waitUntilOnline(signal);
            }
            await waitIndexCooldown(signal);
            if (!(await acquireIndexSlot(signal))) return undefined;
            if (!backgroundedAndSilent() && !isOffline()) break;
          }
          try {
            // The link from the listing is good for about an hour, so retries
            // reuse it. Only a link the server rejected (expired) is replaced:
            // asking Graph for a new one on every retry just adds more
            // requests to a server that's already pushing back.
            if (needFreshUrl) {
              url = await getDownloadUrl(track, { silent: true, priority: "low" });
              needFreshUrl = false;
            }
            const artist = await readArtist(url);
            noteIndexSuccess();
            return artist;
          } catch (err) {
            noteIndexFailure();
            if (/^HTTP (401|403|404)/.test((err && err.message) || "")) needFreshUrl = true;
            throw err;
          }
        },
        { maxAttempts: 3, baseDelayMs: 800, maxDelayMs: 5000 }
      );
      if (artist === undefined) return [];
      applyIndexedArtist(track, artist);
    } catch {
      if (signal.aborted) return [];
      // Backgrounded or offline at any point: not this song's fault. Leave it
      // pending, uncounted, and it gets tried again when we're back.
      if (interrupted || backgroundedAndSilent() || isOffline() || isIndexThrottled()) return [];
      indexFailedIds.add(track.id);
      indexFailCounts.set(track.id, (indexFailCounts.get(track.id) || 0) + 1);
      return [];
    }
    onSongDone();
    return [];
  });
}

// options.onProgress({done, total, state}) — state: "running" | "done" |
// "stopped" | "datasaver". Resolves with the final state. options.force
// starts even on data saver and forgives earlier failures (the user
// explicitly asked, e.g. the Resume button).
async function startIndexing(options = {}) {
  const { force = false, onProgress } = options;
  if (isIndexing || isScanning || !libraryTracks.length) return "skipped";
  const notify = (state, extra) => onProgress && onProgress({ ...indexCounts(), state, ...extra });
  if (!force && navigator.connection && navigator.connection.saveData) {
    notify("datasaver");
    return "datasaver";
  }
  if (force) resetIndexState();
  indexFailedIds = new Set(); // a fresh run may retry what failed last run (strikes still apply)
  if (!pickNextIndexFolder()) {
    notify("done"); // nothing left to read: don't touch the saved cache
    return "done";
  }

  isIndexing = true;
  indexAbortController = new AbortController();
  const signal = indexAbortController.signal;
  const rootId = getLibraryRootId();
  indexCooldownUntil = 0;
  indexNextSlotAt = 0;
  indexConsecutiveFailures = 0;
  indexThrottleNotifier = (ms) => {
    notify("throttled", { retryInSeconds: Math.round(ms / 1000) });
    setTimeout(() => {
      if (isIndexing) notify("running");
    }, ms + 200);
  };
  let sinceSave = 0;
  let sinceNotify = 0;
  const onSongDone = () => {
    if (++sinceSave >= INDEX_SAVE_EVERY) {
      sinceSave = 0;
      cacheLibrary(rootId);
    }
    if (++sinceNotify >= INDEX_NOTIFY_EVERY) {
      sinceNotify = 0;
      notify("running");
    }
  };

  let state = "done";
  try {
    notify("running");
    // Songs that failed during a rough patch (OneDrive pushing back for a
    // minute) are skipped for the rest of a pass so one bad file can't stall
    // the run. Once the pass is over the network has usually recovered, so give
    // them another go right away, up to INDEX_RETRY_PASSES times. Real strikes
    // still cap how often any one song is tried.
    for (let pass = 0; pass <= INDEX_RETRY_PASSES && !signal.aborted; pass++) {
      while (!signal.aborted) {
        await waitUntilVisible(signal);
        await waitUntilOnline(signal);
        if (signal.aborted) break;
        const folderId = pickNextIndexFolder();
        if (!folderId) break;
        await indexOneFolder(folderId, signal, onSongDone);
        notify("running"); // folder finished: refresh whatever's on screen now
      }
      if (signal.aborted) break;
      const retryable = libraryTracks.some((t) => !t.indexed && t.folderId && indexFailedIds.has(t.id) && (indexFailCounts.get(t.id) || 0) < INDEX_MAX_STRIKES);
      if (!retryable) break;
      for (let waited = 0; waited < INDEX_RETRY_PAUSE_MS && !signal.aborted; waited += 250) await new Promise((r) => setTimeout(r, 250)); // let the network settle first
      if (signal.aborted) break;
      indexFailedIds = new Set();
    }
    if (signal.aborted) state = "stopped";
  } finally {
    isIndexing = false;
    indexAbortController = null;
    indexThrottleNotifier = null;
    cacheLibrary(rootId);
    notify(state);
  }
  return state;
}
