// Background artist indexer — tier 2 of the library (tier 1 is the fast
// filename scan in library.js). Reads each song's embedded artist tag once,
// folder by folder, and saves it on the track so it never has to be read
// again. Design rules:
//   - Visible first: the folder you're looking at is always indexed before
//     anything else, so what's on screen fills in within seconds.
//   - One folder listing (a single Graph call) hands over fresh download
//     links for every file in that folder — no per-song link lookups.
//   - Small ranged reads only (see readArtist in id3.js), several at a time.
//   - Only runs while the app is on screen; resumable; progress saved as it
//     goes; stoppable via Settings.

const INDEX_CONCURRENCY = 8;
const INDEX_SAVE_EVERY = 100; // songs between saves of the library cache
const INDEX_NOTIFY_EVERY = 25; // songs between progress callbacks

// Set by app.js whenever the main view opens a folder — see openFolder().
let indexPriorityFolderId = null;
// Songs that failed this session (network trouble, unreadable). Left
// un-indexed so the next session tries them again, but skipped for the rest of
// this run so one bad file can't keep the loop spinning on the same folder.
let indexFailedIds = new Set();

function indexCounts() {
  let done = 0;
  for (const t of libraryTracks) if (t.indexed) done++;
  return { done, total: libraryTracks.length };
}

// Waits while the app is in the background: the WebView freezes timers there
// anyway, and there's no reason to spend battery/data indexing unseen.
function waitUntilVisible(signal) {
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      if (document.hidden && !signal.aborted) return;
      document.removeEventListener("visibilitychange", finish);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    document.addEventListener("visibilitychange", finish);
    signal.addEventListener("abort", finish);
  });
}

// The folder to index next: the one on screen if it still has work, else the
// first folder that does. Recomputed per folder (cheap) so navigating
// somewhere else re-prioritises immediately.
function pickNextIndexFolder() {
  const pending = new Map();
  for (const t of libraryTracks) {
    if (t.indexed || !t.folderId || indexFailedIds.has(t.id)) continue;
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
    for (const t of libraryTracks) if (t.folderId === folderId) indexFailedIds.add(t.id);
    return;
  }
  // Fresh download links for the whole folder from one request.
  const urlById = new Map(listing.tracks.map((r) => [r.id, r["@microsoft.graph.downloadUrl"]]));
  const todo = libraryTracks.filter((t) => t.folderId === folderId && !t.indexed && !indexFailedIds.has(t.id));

  await runWithConcurrency(INDEX_CONCURRENCY, todo, async (track) => {
    if (signal.aborted) return [];
    let attempt = 0;
    try {
      const artist = await retryWithBackoff(
        async () => {
          if (signal.aborted) return undefined; // not an error: just stop quietly
          // First try uses the link from the listing; a retry asks for a new
          // one in case that link is what went bad.
          const url = (attempt++ === 0 && urlById.get(track.id)) || (await getDownloadUrl(track, { silent: true, priority: "low" }));
          return await readArtist(url);
        },
        { maxAttempts: 3, baseDelayMs: 800, maxDelayMs: 5000 }
      );
      if (artist === undefined) return [];
      applyIndexedArtist(track, artist);
    } catch {
      if (!signal.aborted) indexFailedIds.add(track.id);
      return [];
    }
    onSongDone();
    return [];
  });
}

// options.onProgress({done, total, state}) — state: "running" | "done" |
// "stopped" | "datasaver". Resolves with the final state. options.force
// starts even on data saver (the user explicitly asked).
async function startIndexing(options = {}) {
  const { force = false, onProgress } = options;
  if (isIndexing || isScanning || !libraryTracks.length) return "skipped";
  const notify = (state) => onProgress && onProgress({ ...indexCounts(), state });
  if (!force && navigator.connection && navigator.connection.saveData) {
    notify("datasaver");
    return "datasaver";
  }

  if (force) indexFailedIds = new Set(); // "Resume" also retries songs that failed earlier this session
  isIndexing = true;
  indexAbortController = new AbortController();
  const signal = indexAbortController.signal;
  const rootId = getLibraryRootId();
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
    while (!signal.aborted) {
      await waitUntilVisible(signal);
      if (signal.aborted) break;
      const folderId = pickNextIndexFolder();
      if (!folderId) break;
      await indexOneFolder(folderId, signal, onSongDone);
      notify("running"); // folder finished: refresh whatever's on screen now
    }
    if (signal.aborted) state = "stopped";
  } finally {
    isIndexing = false;
    indexAbortController = null;
    cacheLibrary(rootId);
    notify(state);
  }
  return state;
}
