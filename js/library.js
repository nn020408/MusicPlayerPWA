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
// don't get reused silently.
const LIBRARY_CACHE_VERSION = 3;

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
// cheap even while you're typing.
function slimTrack(t) {
  const artist = (t.audio && t.audio.artist) || "";
  const album = (t.audio && t.audio.album) || "";
  return {
    id: t.id,
    name: t.name,
    audio: t.audio ? { artist: t.audio.artist, album: t.audio.album } : null,
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

async function scanLibrary(onProgress) {
  if (isScanning) return libraryTracks;
  isScanning = true;
  const rootId = getLibraryRootId();
  const tracks = [];
  let foldersScanned = 0;

  async function handleFolder(folderId) {
    const { folders, tracks: folderTracks } = await listFolder(folderId, { priority: "low" });
    tracks.push(...folderTracks.map(slimTrack));
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
  return libraryTracks;
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
