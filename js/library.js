// Builds an in-memory (and locally cached) index of every audio track under
// the chosen library folder, so Search can work across your whole collection
// instead of one raw OneDrive folder at a time.
//
// Two tiers, on purpose:
//   1. scanLibrary() (this file): lists folders only, finds every song by
//      name. Fast — it never opens a file.
//   2. The artist indexer (js/indexer.js): reads each song's embedded artist
//      tag in the background, folder by folder, starting with the folder
//      you're looking at. Results are saved on each track (audio.artist +
//      indexed) so it only ever has to happen once per song.

const LIBRARY_CACHE_KEY = "libraryIndexCache";
const DEFAULT_FOLDER_KEY = "defaultFolderPath"; // shared with the Folders tab's "default folder" setting

let libraryTracks = [];
// folderId -> path relative to the library root ("" for the root itself),
// recorded by scanLibrary() so songs can be matched to the PC-made artists file.
let libraryFolderPaths = {};
let isScanning = false;
let isIndexing = false; // owned by js/indexer.js; declared here so stop/active checks below can see it

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
// don't get reused silently. Bumped to 7: tracks now carry folderId (so the
// indexer can work folder by folder) and _searchText is accent-insensitive
// and includes the artist.
const LIBRARY_CACHE_VERSION = 7;

function loadCachedLibrary() {
  try {
    const raw = localStorage.getItem(LIBRARY_CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed.version !== LIBRARY_CACHE_VERSION) return false; // old format — force a fresh scan
    if (parsed.rootId !== getLibraryRootId()) return false; // stale — root folder changed
    libraryTracks = parsed.tracks;
    libraryFolderPaths = parsed.folderPaths || {};
    invalidateArtistsCache();
    return true;
  } catch {
    return false;
  }
}

function cacheLibrary(rootId) {
  try {
    localStorage.setItem(
      LIBRARY_CACHE_KEY,
      JSON.stringify({ rootId, tracks: libraryTracks, folderPaths: libraryFolderPaths, scannedAt: Date.now(), version: LIBRARY_CACHE_VERSION })
    );
    return true;
  } catch (err) {
    console.warn("Library too large to cache locally — will rescan next time", err);
    return false;
  }
}

// Wipes the scanned library and every artist read so far, in memory and in
// the saved cache. Playlists, backups and the chosen music folder are not
// touched. The next scanLibrary() then starts from nothing, so unlike a plain
// rescan it keeps no previously read artists.
function resetLibrary() {
  localStorage.removeItem(LIBRARY_CACHE_KEY);
  libraryTracks = [];
  libraryFolderPaths = {};
  artistsFileSync = null;
  invalidateArtistsCache();
}

// ---------- Text helpers ----------

// Lowercase with accents stripped, so "Celedón", "celedon" and "CELEDÓN" all
// compare equal — matches how Windows search behaves.
function normalizeText(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function buildSearchText(name, artist) {
  return normalizeText(`${name.replace(/\.[^/.]+$/, "")} ${artist || ""}`);
}

// ---------- Track shape ----------

// Graph's raw item objects carry a lot we don't need to keep around (download
// URLs, file hashes, full parent paths, timestamps) — for a few thousand
// tracks that's easily several MB, enough to blow past localStorage's quota
// and silently fail to cache. Keep only what display/search/playback need.
// _searchText is precomputed once here (not per keystroke) so Search stays
// cheap even while you're typing.
//   prior: Map(id -> artist) of songs a previous scan already indexed, so a
//   rescan (e.g. after adding new songs) doesn't throw that work away.
function makeTrack(t, folderId, prior) {
  const known = prior && prior.has(t.id);
  const artist = known ? prior.get(t.id) : (t.audio && t.audio.artist) || "";
  const track = {
    id: t.id,
    name: t.name,
    folderId,
    audio: artist ? { artist } : null,
    _searchText: buildSearchText(t.name, artist),
  };
  if (known || artist) track.indexed = true;
  return track;
}

// Lightweight copy of an existing track, used for saved playback state.
function slimTrack(t) {
  const copy = { id: t.id, name: t.name, audio: t.audio ? { artist: t.audio.artist } : null, _searchText: t._searchText };
  if (t.folderId) copy.folderId = t.folderId;
  if (t.indexed) copy.indexed = true;
  return copy;
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

// Lets Settings' Stop control cancel an in-progress scan or artist indexing.
let scanAbortController = null;
let indexAbortController = null; // set/cleared by js/indexer.js

function stopLibraryWork() {
  if (scanAbortController) scanAbortController.abort();
  if (indexAbortController) indexAbortController.abort();
}

function isLibraryWorkActive() {
  return isScanning || isIndexing;
}

async function scanLibrary(onProgress) {
  if (isScanning) return libraryTracks;
  isScanning = true;
  scanAbortController = new AbortController();
  const signal = scanAbortController.signal;
  const rootId = getLibraryRootId();
  // Artists a previous scan/session already read from the files, so a rescan
  // keeps them instead of forcing the whole indexing pass to start over.
  const prior = new Map(libraryTracks.filter((t) => t.indexed).map((t) => [t.id, (t.audio && t.audio.artist) || ""]));
  const tracks = [];
  const folderPaths = { [rootId]: "" };
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
    for (const t of folderTracks) tracks.push(makeTrack(t, folderId, prior));
    const here = folderPaths[folderId];
    for (const f of folders) folderPaths[f.id] = here ? `${here}/${f.name}` : f.name;
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
      libraryFolderPaths = folderPaths;
      artistsFileSync = null; // a new scan may have new songs the file can fill in
      invalidateArtistsCache();
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

// ---------- Artists file (made on the PC) ----------
//
// tools/scan-artists.js reads every tag from the local copy of the library and
// writes nubeplayer-artists.json into the library's root folder; OneDrive syncs
// it. One download here fills in nearly every artist at once, instead of
// reading thousands of files over the network. It is only ever a shortcut:
// missing, stale or unreadable, the background indexer reads whatever is left.

// Applies the file's { "folder/song.mp3": "Artist" } entries to songs not yet
// read. An empty artist means "the file has no tag", which also counts as read.
// Matched by folder path + file name, so the same song name in two folders can't
// get mixed up. Returns { applied, none, missing }.
function applyArtistsFile(data) {
  if (!data || data.version !== 2 || !data.files || typeof data.files !== "object") throw new Error("unrecognised artists file");
  const known = new Map();
  for (const [p, artist] of Object.entries(data.files)) known.set(normalizeText(p), typeof artist === "string" ? artist.trim() : "");
  let applied = 0;
  let none = 0;
  let missing = 0;
  for (const t of libraryTracks) {
    if (t.indexed) continue;
    const dir = libraryFolderPaths[t.folderId];
    const key = dir === undefined ? null : normalizeText(dir ? `${dir}/${t.name}` : t.name);
    if (key === null || !known.has(key)) {
      missing++;
      continue;
    }
    const artist = known.get(key);
    t.indexed = true;
    if (artist) {
      t.audio = { artist };
      applied++;
    } else {
      none++;
    }
    t._searchText = buildSearchText(t.name, artist);
  }
  invalidateArtistsCache();
  return { applied, none, missing };
}

// Downloads and applies the file, once per library scan/session. Resolves to
// applyArtistsFile's counts, or null when there was nothing to do or no file.
// Never throws: any problem just leaves the songs for the background indexer.
let artistsFileSync = null;

function syncArtistsFile() {
  if (artistsFileSync) return artistsFileSync;
  if (!libraryTracks.some((t) => !t.indexed) || !Object.keys(libraryFolderPaths).length) return Promise.resolve(null);
  const attempt = (async () => {
    try {
      const listing = await listFolder(getLibraryRootId(), { priority: "low" });
      const item = listing.artistsFile;
      if (!item) return null; // no file: nothing to do (and nothing to retry)
      let res = await fetch(item["@microsoft.graph.downloadUrl"] || "");
      if (!res.ok) res = await fetch(await refreshDownloadUrl(item.id, { silent: true })); // link may have expired
      if (!res.ok) throw new Error("HTTP " + res.status);
      const result = applyArtistsFile(await res.json());
      if (result.applied || result.none) cacheLibrary(getLibraryRootId());
      return result;
    } catch (err) {
      console.warn("Artists file not used", err);
      artistsFileSync = null; // might be a passing network problem: allow another try
      return null;
    }
  })();
  artistsFileSync = attempt;
  return attempt;
}

// ---------- Search ----------

// Every word you type has to appear somewhere in the song name or artist, in
// any order and any part of a word — "jorge celed" finds "Jorge Celedón &
// Jimmy Zambrano", same as Windows search does.
function searchTokens(query) {
  return normalizeText(query).split(/\s+/).filter(Boolean);
}

function searchLibrary(query) {
  const tokens = searchTokens(query);
  if (!tokens.length) return [];
  return libraryTracks.filter((t) => tokens.every((tok) => t._searchText.includes(tok)));
}

// ---------- Artists ----------

// One embedded artist tag often credits several people: "Jorge Celedón &
// Jimmy Zambrano", "Diomedes Diaz/Ivan Zuleta", "X con Y". Split on the
// separators that are reliably collaborations. Deliberately NOT split on the
// Spanish "y": it's too often part of a band name ("Fruko y sus Tesos"), and
// a wrong split makes up an artist that doesn't exist. A "/" only splits
// when a name on either side has a space, so "AC/DC" stays whole. The full
// credit is always kept on the song and still matches in Search.
function creditedArtists(raw) {
  const parts = raw.split(/\s*(?:;|,|&|\+)\s*|\s+(?:feat\.?|ft\.?|featuring|x|vs\.?|con|with)\s+/i);
  const out = [];
  for (const p of parts) {
    if (p.includes("/")) {
      const bits = p.split("/").map((s) => s.trim());
      if (bits.some((b) => b.includes(" "))) {
        out.push(...bits);
        continue;
      }
    }
    out.push(p.trim());
  }
  return out.filter(Boolean);
}

let artistsCache = null;
function invalidateArtistsCache() {
  artistsCache = null;
}

// [{key, name, count}] sorted by name. Each song counts under every artist
// credited on it, like Spotify's "appears on".
function getArtists() {
  if (artistsCache) return artistsCache;
  const map = new Map();
  for (const t of libraryTracks) {
    const raw = t.audio && t.audio.artist;
    if (!raw) continue;
    const seen = new Set();
    for (const part of creditedArtists(raw)) {
      const key = normalizeText(part).trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      let entry = map.get(key);
      if (!entry) map.set(key, (entry = { key, names: new Map(), count: 0 }));
      entry.count++;
      entry.names.set(part, (entry.names.get(part) || 0) + 1);
    }
  }
  artistsCache = [...map.values()]
    .map((e) => ({ key: e.key, count: e.count, name: [...e.names.entries()].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return artistsCache;
}

function searchArtists(query) {
  const tokens = searchTokens(query);
  if (!tokens.length) return [];
  return getArtists()
    .filter((a) => tokens.every((tok) => a.key.includes(tok)))
    .sort((a, b) => b.count - a.count);
}

function songsByArtistKey(key) {
  return libraryTracks
    .filter((t) => {
      const raw = t.audio && t.audio.artist;
      return raw && creditedArtists(raw).some((p) => normalizeText(p).trim() === key);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
