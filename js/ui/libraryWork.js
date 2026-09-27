// Running the library scan and the artist reading, and showing their status.
// What happens is announced through `libraryEvents`, so the search screen and
// the song rows can react without this module knowing about them.

import { createEmitter } from "../core/events.js";
import { escapeHtml } from "../core/text.js";
import { el } from "../core/dom.js";
import { clearFolderListCache } from "../data/graph.js";
import { isScanning, libraryTracks, loadCachedLibrary, scanLibrary, syncArtistsFile } from "../data/library.js";
import { syncIndexKeepAlive } from "../data/indexKeepAlive.js";
import { isIndexing, isLibraryWorkActive, startIndexing, stopLibraryWork } from "../data/indexer.js";
import { showToast } from "./toast.js";

export let libraryLoaded = false;

// What the library work (scan, artist reading) announces, so the features that
// care can react without the library code knowing about them:
//   "indexProgress" - artist reading advanced (or its state changed)
//   "scanned"       - a folder scan finished       "scanFailed" - it didn't
//   "reset"         - the library was wiped to start again
export const libraryEvents = createEmitter();

// ---------- Library scan (powers Search — the main view itself is folder browsing) ----------
// Tracks an in-progress scan so every caller (the automatic one on app open,
// and Search opening before it's finished) shares the same attempt instead
// of each kicking off its own — that was the cause of a second "Scanning…"
// toast firing if you opened Search while the automatic scan was still running.
let libraryLoadPromise = null;

// The library was replaced or wiped (new folder, restore, reset, sign-out): the
// next ensureLibraryLoaded() must load it again. forgetLoad also drops a load
// that is still in flight.
export function markLibraryStale({ forgetLoad = false } = {}) {
  libraryLoaded = false;
  if (forgetLoad) libraryLoadPromise = null;
}

// The saved library was just swapped in (restore) and is ready to use.
export function markLibraryLoaded() {
  libraryLoaded = true;
}

export async function ensureLibraryLoaded() {
  if (libraryLoaded) return;
  if (libraryLoadPromise) {
    await libraryLoadPromise; // already running — just wait for it, don't start another
    return;
  }
  if (loadCachedLibrary()) {
    libraryLoaded = true;
    kickOffIndexing(); // picks up wherever a previous session left off
    return;
  }
  libraryLoadPromise = rescanLibrary().finally(() => {
    libraryLoadPromise = null;
  });
  await libraryLoadPromise;
}

// ---------- Artist indexing (js/indexer.js) ----------
// Fire-and-forget: never awaited by whatever triggers it. startIndexing()
// itself no-ops if it's already running or a scan is in progress, so every
// "library just became available" path (cache hit, fresh scan, restore) can
// call this without coordinating.
export let indexState = "idle";

 // idle | running | done | stopped | datasaver

export function kickOffIndexing(force) {
  updateRescanButtonUI();
  // First fill in whatever the PC-made artists file knows (one small download),
  // then let the background indexer read only what's still missing.
  syncArtistsFile()
    .then(() => startIndexing({ force, onProgress: onIndexProgress }))
    .finally(updateRescanButtonUI);
}

// Indexing waits in the background (Android stalls the network there). Pick it
// back up on its own the moment the app is on screen again or the network
// returns, so nobody has to reopen Settings to restart it. Not after the user
// pressed Stop, and not while data saver is holding it back.
function resumeIndexingIfWanted() {
  if (document.hidden || !libraryLoaded) return;
  if (indexState === "stopped" || indexState === "datasaver") return;
  kickOffIndexing();
}

document.addEventListener("visibilitychange", resumeIndexingIfWanted);

window.addEventListener("online", resumeIndexingIfWanted);

function onIndexProgress({ done, total, state, retryInSeconds }) {
  indexState = state;
  const pct = total ? Math.round((done / total) * 100) : 0;
  syncIndexKeepAlive(state, done, total, pct);
  if (state === "running") {
    el.scanStatus.textContent = `Reading artist names in the background… ${done} of ${total} songs (${pct}%)`;
  } else if (state === "throttled") {
    el.scanStatus.textContent = `OneDrive pushed back, so we're easing off the pace for a moment… (${done} of ${total} songs, ${pct}%)`;
  } else if (state === "done") {
    el.scanStatus.textContent =
      done >= total
        ? `Artists ready — all ${total} songs indexed.`
        : `Artists read for ${done} of ${total} songs. The rest will be retried next time you open the app.`;
  } else if (state === "stopped") {
    el.scanStatus.textContent = `Artist indexing stopped at ${pct}%. It resumes next time you open the app, or tap Resume in Search > Artists.`;
  } else if (state === "datasaver") {
    el.scanStatus.textContent = "Artist indexing is paused because data saver is on. Tap Resume in Search > Artists to run it anyway.";
  }
  libraryEvents.emit("indexProgress");
}

// Cancels an in-progress scan and waits for it to actually wind down
// (stopLibraryWork() only signals — the loop still needs a moment to notice
// and drain) before resolving. Used wherever new library work is about to
// replace old (restore, a fresh manual rescan) so the old scan can't keep
// grinding on data that's about to be thrown away — capped so a stuck loop
// can't hang the caller forever.
export async function stopLibraryWorkAndWait() {
  stopLibraryWork();
  for (let i = 0; i < 40 && isLibraryWorkActive(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// Settings' "Rescan library" button doubles as a Stop control while a scan or
// artist indexing is actively running — same button, same slot, since the
// states are mutually exclusive from the user's point of view.
export function updateRescanButtonUI() {
  const active = isLibraryWorkActive();
  el.rescanLibraryBtn.textContent = isScanning ? "⏹ Stop scanning" : isIndexing ? "⏹ Stop indexing" : "Rescan library";
  el.rescanLibraryBtn.classList.toggle("danger", active);
}

// Mirrors scan progress into whichever of Settings / Search is currently
// open (or both), so they never show different or stale info.
function setScanProgressUI(html) {
  el.scanStatus.innerHTML = html;
  if (!el.searchOverlay.classList.contains("hidden") && !el.searchInput.value.trim()) {
    el.searchResults.innerHTML = `<p class="status-msg">${html}</p>`;
  }
}

export async function rescanLibrary() {
  // A scan already in progress (e.g. triggered elsewhere) would otherwise
  // keep running alongside this new one, both racing to write libraryTracks.
  await stopLibraryWorkAndWait();
  clearFolderListCache(); // otherwise "rescan" would just re-read cached folder data
  showToast("Scanning your music for search…");
  updateRescanButtonUI();
  let finalFolderCount = 0;
  const onProgress = (folders, tracks, warning) => {
    finalFolderCount = folders;
    const msg = `Scanning for search… ${folders} folder${folders === 1 ? "" : "s"}, ${tracks} song${tracks === 1 ? "" : "s"} found`;
    setScanProgressUI(`<span class="spinner"></span>${escapeHtml(warning ? `${msg} (${warning})` : msg)}`);
  };
  try {
    await scanLibrary(onProgress);
    libraryLoaded = true;
    const doneMsg = `Done — ${finalFolderCount} folder${finalFolderCount === 1 ? "" : "s"}, ${libraryTracks.length} song${libraryTracks.length === 1 ? "" : "s"} found.`;
    el.scanStatus.textContent = doneMsg;
    libraryEvents.emit("scanned");
    showToast(`Search ready — ${finalFolderCount} folder${finalFolderCount === 1 ? "" : "s"}, ${libraryTracks.length} song${libraryTracks.length === 1 ? "" : "s"} found`);
    kickOffIndexing();
  } catch (err) {
    console.error(err);
    el.scanStatus.textContent = "Scan failed: " + (err.message || err);
    libraryEvents.emit("scanFailed");
    showToast("Couldn't finish scanning your library");
  } finally {
    updateRescanButtonUI();
  }
}