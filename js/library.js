// Builds an in-memory (and locally cached) index of every audio track under
// the chosen library folder, so Songs/Albums/Artists/Search can work across
// your whole collection instead of one raw OneDrive folder at a time.

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
// don't get reused silently. Bumped to 5: _needsArtistLookup used to also be
// satisfied by a filename guess, which could be wrong and would then never
// get corrected — existing caches may have wrongly "resolved" tracks baked
// in under that old logic, so they need a fresh scan to re-flag properly.
const LIBRARY_CACHE_VERSION = 5;

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

// Best-effort artist guess from "Artist - Title.mp3"-style filenames (also
// handles a leading track number: "03 - Artist - Title.mp3"). Free and
// instant — no network — so always tried first, before ever resorting to a
// real (networked) tag read. OneDrive's own automatic metadata extraction
// (t.audio.artist below) is inconsistent enough across formats/sources that
// on some libraries it comes back empty for nearly everything, which is what
// this and enrichArtists() together exist to work around.
function guessArtistFromFilename(name) {
  const base = name.replace(/\.[^/.]+$/, "");
  const withoutTrackNumber = base.replace(/^\s*\d{1,3}[\s.\-_]+/, "");
  const parts = withoutTrackNumber.split(/\s+-\s+/);
  return parts.length >= 2 && parts[0].trim() ? parts[0].trim() : null;
}

// Graph's raw item objects carry a lot we don't need to keep around (download
// URLs, file hashes, full parent paths, timestamps) — for a few thousand
// tracks that's easily several MB, enough to blow past localStorage's quota
// and silently fail to cache. Keep only what display/search/playback need.
// _searchText is precomputed once here (not per keystroke) so Search stays
// cheap even while you're typing.
function slimTrack(t) {
  const graphArtist = (t.audio && t.audio.artist) || "";
  const album = (t.audio && t.audio.album) || "";
  const artist = graphArtist || guessArtistFromFilename(t.name) || "";
  return {
    id: t.id,
    name: t.name,
    audio: artist || album ? { artist, album } : null,
    // Deliberately keyed on graphArtist alone, NOT the filename guess above —
    // that guess is only ever a placeholder to show while waiting, never
    // proof the artist is actually known. It can be flat-out wrong (a title
    // with its own " - " in it, e.g. "El Preso - En Vivo.mp3", reads as
    // artist "El Preso"), and treating a wrong guess as "resolved" would
    // permanently block enrichArtists() from ever reading the real embedded
    // tag underneath it and correcting it. Only OneDrive's own metadata
    // counts as confirmed; everything else always gets the real check.
    _needsArtistLookup: !graphArtist,
    _searchText: `${t.name} ${artist} ${album}`.toLowerCase(),
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

// Populated by scanLibrary() below with { id, url } for every track flagged
// _needsArtistLookup — url is the @microsoft.graph.downloadUrl already
// returned by this same folder listing (session-only, never persisted: it's
// short-lived and slimTrack() deliberately strips it from the cached shape).
// enrichArtists() consumes and clears this so it can reuse those URLs instead
// of asking Graph for a fresh one per track — same data, half the requests.
let pendingEnrichmentQueue = null;

async function scanLibrary(onProgress) {
  if (isScanning) return libraryTracks;
  isScanning = true;
  const rootId = getLibraryRootId();
  const tracks = [];
  const enrichmentQueue = [];
  let foldersScanned = 0;

  async function handleFolder(folderId) {
    // Retried the same as every other folder listing in the app — a
    // multi-minute full-library scan is exactly where a single flaky
    // request used to be most costly: without this, one blip anywhere in
    // the tree aborted the entire scan instead of just riding it out.
    const { folders, tracks: folderTracks } = await retryWithBackoff(() => listFolder(folderId, { priority: "low" }), {
      onRetry: (attempt) => {
        onProgress && onProgress(foldersScanned, tracks.length, `connection trouble — retrying (${attempt})…`);
      },
    });
    for (const t of folderTracks) {
      const slim = slimTrack(t);
      tracks.push(slim);
      if (slim._needsArtistLookup && t["@microsoft.graph.downloadUrl"]) {
        enrichmentQueue.push({ id: slim.id, url: t["@microsoft.graph.downloadUrl"] });
      }
    }
    foldersScanned++;
    onProgress && onProgress(foldersScanned, tracks.length);
    return folders.map((f) => f.id);
  }

  try {
    await runWithConcurrency(SCAN_CONCURRENCY, [rootId], handleFolder);
    libraryTracks = tracks;
    const cached = cacheLibrary(rootId);
    if (!cached) {
      onProgress && onProgress(foldersScanned, tracks.length, "warning: too large to cache — will rescan next time");
    }
  } finally {
    isScanning = false;
  }
  pendingEnrichmentQueue = enrichmentQueue;
  return libraryTracks;
}

// One-time background pass to find real artist tags for whatever OneDrive's
// own metadata and the filename guess both came up empty on (flagged by
// slimTrack as _needsArtistLookup). Deliberately NOT part of scanLibrary
// itself — Search/Songs/Artists are usable the moment the scan above
// finishes, and this keeps chipping away afterwards without blocking any of
// that. Text-only reads via readId3TagsLight, low-priority + silent Graph
// calls (never competes with or spams the error log over something you're
// actively doing), and it still skips entirely on a metered connection.
// Concurrency/pacing below are tuned for throughput rather than being
// maximally gentle — same origin, same request shape as the rest of the app
// (matches SCAN_CONCURRENCY's folder-listing concurrency), just no longer
// artificially slowed down on top of that. Results get folded into the same
// cache scanLibrary writes, and _needsArtistLookup is cleared per track
// whether or not a tag was actually found, so a later app open never
// re-checks a track this already looked at.
const ENRICH_CONCURRENCY = 6;
const ENRICH_PACE_MS = 50; // small floor only, so a run of instant failures still can't fire back-to-back with literally zero gap
let isEnriching = false;

async function enrichArtists(onProgress) {
  if (isEnriching) return;
  if (navigator.connection && navigator.connection.saveData) return; // respect data saver, same as player.js's prefetchNextTrackBlob
  const candidates = libraryTracks.filter((t) => t._needsArtistLookup);
  if (candidates.length === 0) return;

  const urlById = new Map((pendingEnrichmentQueue || []).map((e) => [e.id, e.url]));
  pendingEnrichmentQueue = null;

  isEnriching = true;
  // See setArtistEnrichmentKeepAlive in player.js: on Android, this pass
  // needs the WebView kept "audible" with the screen off exactly the way
  // playback does — same fetch()+setTimeout machinery, same freeze risk if
  // nothing's actively playing while this runs. No-op on web/if nothing has
  // triggered the native keep-alive element to exist.
  if (typeof setArtistEnrichmentKeepAlive === "function") setArtistEnrichmentKeepAlive(true);
  const rootId = getLibraryRootId();
  let checked = 0;
  let found = 0;
  let lastCheckpointAt = 0;

  try {
    // ENRICH_CONCURRENCY slots, each gated by ENRICH_PACE_MS before it can
    // pick up its next track — throughput here is bounded by real OneDrive
    // response latency (the thing actually worth waiting on), not by an
    // artificial floor on top of it; ENRICH_PACE_MS just stops a slot from
    // firing with literally zero gap if a lookup ever fails instantly.
    await runWithConcurrency(ENRICH_CONCURRENCY, candidates, async (track) => {
      try {
        // Retried with backoff the same as every other network read in this
        // app (folder listing, playback) — a bulk pass over thousands of
        // tracks is exactly where a transient failure/rate-limit is likely,
        // and without this a single bad moment would permanently give up on
        // that track (see _needsArtistLookup being cleared below regardless
        // of outcome) instead of just riding the blip out.
        let attempt = 0;
        const tags = await retryWithBackoff(
          async () => {
            // Only the very first attempt gets to use the URL captured
            // during this session's scan — any retry always asks Graph for
            // a fresh one, in case the cached one is what's actually bad.
            // silent: a missing/failed lookup here is routine and already
            // handled (track just stays unresolved), not worth the visible
            // error log entry a real playback failure gets. priority: "low"
            // so this never competes with something you're actively doing.
            const url = (attempt === 0 && urlById.get(track.id)) || (await getDownloadUrl(track, { silent: true, priority: "low" }));
            attempt++;
            const result = url && (await readId3TagsLight(url));
            if (!result) throw new Error("Tag read came back empty"); // readId3TagsLight resolves null instead of rejecting — turn that back into a retryable failure
            return result;
          },
          { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 8000 }
        );
        if (tags.artist || tags.album) {
          const artist = tags.artist || "";
          const album = tags.album || (track.audio && track.audio.album) || "";
          track.audio = artist || album ? { artist, album } : track.audio;
          track._searchText = `${track.name} ${artist} ${album}`.toLowerCase();
          if (artist) found++;
        }
      } catch {
        // Genuinely exhausted retries, or the file just has no tag at all —
        // falls through to marking this track checked below; a full
        // "Rescan library" can retry it later.
      }
      track._needsArtistLookup = false;
      checked++;
      onProgress && onProgress(checked, candidates.length, found);
      // Periodic checkpoint so closing the app mid-pass doesn't lose
      // everything found so far — same idea as player.js's throttled
      // savePlaybackState, just counted in tracks instead of milliseconds.
      if (checked - lastCheckpointAt >= 200) {
        lastCheckpointAt = checked;
        cacheLibrary(rootId);
      }
      await new Promise((resolve) => setTimeout(resolve, ENRICH_PACE_MS));
      return [];
    });
  } finally {
    isEnriching = false;
    if (typeof setArtistEnrichmentKeepAlive === "function") setArtistEnrichmentKeepAlive(false);
  }
  cacheLibrary(rootId);
}

function getAllSongs() {
  return [...libraryTracks].sort((a, b) => a.name.localeCompare(b.name));
}

function getAlbums() {
  const map = new Map();
  for (const t of libraryTracks) {
    const albumName = (t.audio && t.audio.album) || "Unknown Album";
    const artistName = (t.audio && t.audio.artist) || "Unknown Artist";
    const key = albumName + "␟" + artistName;
    if (!map.has(key)) map.set(key, { key, name: albumName, artist: artistName, tracks: [] });
    map.get(key).tracks.push(t);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function getArtists() {
  const map = new Map();
  for (const t of libraryTracks) {
    const artistName = (t.audio && t.audio.artist) || "Unknown Artist";
    if (!map.has(artistName)) map.set(artistName, { key: artistName, name: artistName, tracks: [] });
    map.get(artistName).tracks.push(t);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function searchLibrary(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return libraryTracks.filter((t) => t._searchText.includes(q));
}
