// Builds an in-memory (and locally cached) index of every audio track under
// the chosen library folder, so Search can work across your whole collection
// instead of one raw OneDrive folder at a time. Artist/album browsing was
// tried and pulled back out (too slow/unreliable a source of truth for real
// artist data over a plain HTTP-only, no-local-disk app) — this only scans
// for songs by name now. May come back later.

const LIBRARY_CACHE_KEY = "libraryIndexCache";
const DEFAULT_FOLDER_KEY = "defaultFolderPath"; // shared with the Folders tab's "default folder" setting

let libraryTracks = [];
let isScanning = false;

function getLibraryRootId() {
  try {
    const raw = localStorage.getItem(DEFAULT_FOLDER_KEY);
    if (!raw) return "root";
    const stack = JSON.parse(raw);
    return stack.length ? stack[stack.length - 1].id : "root";
  } catch {
    return "root";
  }
}

function getLibraryRootLabel() {
  try {
    const raw = localStorage.getItem(DEFAULT_FOLDER_KEY);
    if (!raw) return "OneDrive (everything)";
    const stack = JSON.parse(raw);
    return stack.length ? stack[stack.length - 1].name : "OneDrive (everything)";
  } catch {
    return "OneDrive (everything)";
  }
}

// Bump this whenever the cached track shape or scan logic changes, so old
// (possibly incomplete/stale) caches from a previous version of the app
// don't get reused silently. Bumped to 6: dropped the artist-enrichment
// fields (_needsArtistLookup etc.) from the track shape entirely — existing
// caches predate that and need a fresh scan to pick up the simpler shape.
const LIBRARY_CACHE_VERSION = 6;

function loadCachedLibrary() {
  try {
    const raw = localStorage.getItem(LIBRARY_CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed.version !== LIBRARY_CACHE_VERSION) return false; // old format — force a fresh scan
    if (parsed.rootId !== getLibraryRootId()) return false; // stale — root folder changed
    libraryTracks = parsed.tracks;
    return true;
  } catch {
    return false;
  }
}

function cacheLibrary(rootId) {
  try {
    localStorage.setItem(
      LIBRARY_CACHE_KEY,
      JSON.stringify({ rootId, tracks: libraryTracks, scannedAt: Date.now(), version: LIBRARY_CACHE_VERSION })
    );
    return true;
  } catch (err) {
    console.warn("Library too large to cache locally — will rescan next time", err);
    return false;
  }
}

// Graph's raw item objects carry a lot we don't need to keep around (download
// URLs, file hashes, full parent paths, timestamps) — for a few thousand
// tracks that's easily several MB, enough to blow past localStorage's quota
// and silently fail to cache. Keep only what display/search/playback need.
// _searchText is precomputed once here (not per keystroke) so Search stays
// cheap even while you're typing — song name only for now (see the note at
// the top of this file).
function slimTrack(t) {
  return {
    id: t.id,
    name: t.name,
    audio: t.audio ? { artist: t.audio.artist, album: t.audio.album } : null,
    _searchText: t.name.toLowerCase(),
  };
}

// Runs `handler` over a growing work queue with at most `concurrency` calls
// in flight at once. `handler` returns an array of new items to add to the
// queue (or nothing) — used here so discovering subfolders keeps feeding the
// same pool instead of walking one folder at a time.
function runWithConcurrency(concurrency, initialItems, handler) {
  return new Promise((resolve, reject) => {
    const queue = [...initialItems];
    let index = 0;
    let active = 0;

    function pump() {
      if (index >= queue.length && active === 0) {
        resolve();
        return;
      }
      while (active < concurrency && index < queue.length) {
        const item = queue[index++];
        active++;
        handler(item)
          .then((more) => {
            if (more && more.length) queue.push(...more);
          })
          .catch(reject)
          .finally(() => {
            active--;
            pump();
          });
      }
    }
    pump();
  });
}

// Walks every folder under the library root, collecting audio files. Folders
// are fetched several at a time (bounded concurrency) rather than strictly
// one-by-one — cuts wall-clock scan time substantially for wide folder trees
// while still staying well under Graph rate limits. onProgress lets the UI
// show live scan feedback.
const SCAN_CONCURRENCY = 5;

// Lets Settings' Stop control cancel an in-progress scan.
let scanAbortController = null;

function stopLibraryWork() {
  if (scanAbortController) scanAbortController.abort();
}

function isLibraryWorkActive() {
  return isScanning;
}

async function scanLibrary(onProgress) {
  if (isScanning) return libraryTracks;
  isScanning = true;
  scanAbortController = new AbortController();
  const signal = scanAbortController.signal;
  const rootId = getLibraryRootId();
  const tracks = [];
  let foldersScanned = 0;

  async function handleFolder(folderId) {
    if (signal.aborted) return [];
    // Retried the same as every other folder listing in the app — a
    // multi-minute full-library scan is exactly where a single flaky
    // request used to be most costly: without this, one blip anywhere in
    // the tree aborted the entire scan instead of just riding it out.
    const { folders, tracks: folderTracks } = await retryWithBackoff(() => listFolder(folderId, { priority: "low" }), {
      onRetry: (attempt) => {
        onProgress && onProgress(foldersScanned, tracks.length, `connection trouble — retrying (${attempt})…`);
      },
    });
    tracks.push(...folderTracks.map(slimTrack));
    foldersScanned++;
    onProgress && onProgress(foldersScanned, tracks.length);
    return signal.aborted ? [] : folders.map((f) => f.id);
  }

  try {
    await runWithConcurrency(SCAN_CONCURRENCY, [rootId], handleFolder);
    // A stopped-mid-scan result is necessarily incomplete — better to keep
    // whatever the library already had (from before this scan started) than
    // silently replace it with a partial folder tree.
    if (!signal.aborted) {
      libraryTracks = tracks;
      const cached = cacheLibrary(rootId);
      if (!cached) {
        onProgress && onProgress(foldersScanned, tracks.length, "warning: too large to cache — will rescan next time");
      }
    }
  } finally {
    isScanning = false;
    scanAbortController = null;
  }
  return libraryTracks;
}

function searchLibrary(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return libraryTracks.filter((t) => t._searchText.includes(q));
}
