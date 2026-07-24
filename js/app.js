// Wires the UI to auth, the library index, playlists, and the player.

const el = {
  loginScreen: document.getElementById("login-screen"),
  appScreen: document.getElementById("app-screen"),
  signInBtn: document.getElementById("sign-in-btn"),
  signOutBtn: document.getElementById("sign-out-btn"),
  shuffleViewBtn: document.getElementById("shuffle-view-btn"),
  searchBtn: document.getElementById("search-btn"),
  playlistsBtn: document.getElementById("playlists-btn"),
  settingsBtn: document.getElementById("settings-btn"),

  breadcrumb: document.getElementById("breadcrumb"),
  fileList: document.getElementById("file-list"),
  statusMsg: document.getElementById("status-msg"),

  topBar: document.getElementById("top-bar"),
  selectToggleBtn: document.getElementById("select-toggle-btn"),
  selectHeaderBar: document.getElementById("select-header-bar"),
  selectHeaderLabel: document.getElementById("select-header-label"),
  selectCancelBtn: document.getElementById("select-cancel-btn"),
  selectAllBtn: document.getElementById("select-all-btn"),
  selectActionBar: document.getElementById("select-action-bar"),
  selectCountLabel: document.getElementById("select-count-label"),
  selectAddPlaylistBtn: document.getElementById("select-add-playlist-btn"),
  selectShuffleBtn: document.getElementById("select-shuffle-btn"),

  searchOverlay: document.getElementById("search-overlay"),
  searchInput: document.getElementById("search-input"),
  searchCloseBtn: document.getElementById("search-close-btn"),
  searchResults: document.getElementById("search-results"),

  playlistsOverlay: document.getElementById("playlists-overlay"),
  playlistsCloseBtn: document.getElementById("playlists-close-btn"),
  newPlaylistBtn: document.getElementById("new-playlist-btn"),
  playlistsList: document.getElementById("playlists-list"),

  settingsOverlay: document.getElementById("settings-overlay"),
  settingsCloseBtn: document.getElementById("settings-close-btn"),
  libraryRootLabel: document.getElementById("library-root-label"),
  changeFolderBtn: document.getElementById("change-folder-btn"),
  rescanLibraryBtn: document.getElementById("rescan-library-btn"),
  backupBtn: document.getElementById("backup-btn"),
  restoreBtn: document.getElementById("restore-btn"),
  restoreFileInput: document.getElementById("restore-file-input"),
  scanStatus: document.getElementById("scan-status"),
  themeList: document.getElementById("theme-list"),
  appVersionLabel: document.getElementById("app-version-label"),
  loginVersionLabel: document.getElementById("login-version-label"),
  errorLogBtn: document.getElementById("error-log-btn"),

  errorLogOverlay: document.getElementById("error-log-overlay"),
  errorLogBackBtn: document.getElementById("error-log-back-btn"),
  errorLogCopyBtn: document.getElementById("error-log-copy-btn"),
  errorLogClearBtn: document.getElementById("error-log-clear-btn"),
  errorLogList: document.getElementById("error-log-list"),

  detailOverlay: document.getElementById("detail-overlay"),
  detailBackBtn: document.getElementById("detail-back-btn"),
  detailTitle: document.getElementById("detail-title"),
  detailList: document.getElementById("detail-list"),
  detailHeaderActions: document.getElementById("detail-header-actions"),
  detailPlayBtn: document.getElementById("detail-play-btn"),
  detailShuffleBtn: document.getElementById("detail-shuffle-btn"),

  folderPickerOverlay: document.getElementById("folder-picker-overlay"),
  folderPickerHeading: document.getElementById("folder-picker-heading"),
  folderPickerCancelBtn: document.getElementById("folder-picker-cancel-btn"),
  fpHomeBtn: document.getElementById("fp-home-btn"),
  fpBreadcrumb: document.getElementById("fp-breadcrumb"),
  fpFileList: document.getElementById("fp-file-list"),
  fpUseHereBtn: document.getElementById("fp-use-here-btn"),

  toast: document.getElementById("toast"),

  nowPlayingBar: document.getElementById("now-playing-bar"),
  npArt: document.querySelector(".np-art"),
  miniArt: document.getElementById("mini-art"),
  miniArtFallback: document.getElementById("mini-art-fallback"),
  nowPlayingTitle: document.getElementById("now-playing-title"),
  nowPlayingArtist: document.getElementById("now-playing-artist"),
  miniPrevBtn: document.getElementById("mini-prev-btn"),
  miniPlayPauseBtn: document.getElementById("mini-play-pause-btn"),
  miniNextBtn: document.getElementById("mini-next-btn"),

  fullPlayer: document.getElementById("full-player"),
  fullPlayerCloseBtn: document.getElementById("full-player-close-btn"),
  upNextBtn: document.getElementById("up-next-btn"),
  addToPlaylistBtn: document.getElementById("add-to-playlist-btn"),
  lyricsBtn: document.getElementById("lyrics-btn"),
  lyricsPanel: document.getElementById("lyrics-panel"),
  fullPlayerArt: document.querySelector(".full-player-art"),
  fullArt: document.getElementById("full-art"),
  fullArtFallback: document.getElementById("full-art-fallback"),
  fullTitle: document.getElementById("full-title"),
  fullArtist: document.getElementById("full-artist"),
  fullSeekBar: document.getElementById("full-seek-bar"),
  fullCurrentTime: document.getElementById("full-current-time"),
  fullDuration: document.getElementById("full-duration"),
  shuffleBtn: document.getElementById("shuffle-btn"),
  fullPrevBtn: document.getElementById("full-prev-btn"),
  fullPlayPauseBtn: document.getElementById("full-play-pause-btn"),
  fullNextBtn: document.getElementById("full-next-btn"),
  repeatBtn: document.getElementById("repeat-btn"),

  addPlaylistModal: document.getElementById("add-playlist-modal"),
  addPlaylistList: document.getElementById("add-playlist-list"),
  addPlaylistNewBtn: document.getElementById("add-playlist-new-btn"),
  addPlaylistCancelBtn: document.getElementById("add-playlist-cancel-btn"),

  folderActionsModal: document.getElementById("folder-actions-modal"),
  folderActionsTitle: document.getElementById("folder-actions-title"),
  folderPlayBtn: document.getElementById("folder-play-btn"),
  folderAddPlaylistBtn: document.getElementById("folder-add-playlist-btn"),
  folderActionsCancelBtn: document.getElementById("folder-actions-cancel-btn"),

  playlistActionsModal: document.getElementById("playlist-actions-modal"),
  playlistActionsTitle: document.getElementById("playlist-actions-title"),
  playlistRenameBtn: document.getElementById("playlist-rename-btn"),
  playlistDeleteBtn: document.getElementById("playlist-delete-btn"),
  playlistClearBtn: document.getElementById("playlist-clear-btn"),
  playlistActionsCancelBtn: document.getElementById("playlist-actions-cancel-btn"),

  upNextOverlay: document.getElementById("up-next-overlay"),
  upNextCloseBtn: document.getElementById("up-next-close-btn"),
  upNextNowLabel: document.getElementById("up-next-now-label"),
  upNextNowRow: document.getElementById("up-next-now-row"),
  upNextList: document.getElementById("up-next-list"),
};

let libraryLoaded = false;
let pendingTracksForPlaylist = [];

function formatTime(seconds) {
  if (!isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

let toastHideTimer = null;
let toastRemoveTimer = null;
// duration: null means persistent — stays up until hideToast() is called or
// another showToast() replaces it. Used for "still retrying…" messages,
// which must not vanish on their own timer partway through a multi-minute
// reconnect attempt — that reads as "gave up" even when it's still working.
function showToast(message, duration = 2500) {
  clearTimeout(toastHideTimer);
  clearTimeout(toastRemoveTimer);
  el.toast.textContent = message;
  el.toast.classList.remove("hidden");
  requestAnimationFrame(() => el.toast.classList.add("show"));
  if (duration != null) {
    toastHideTimer = setTimeout(() => {
      el.toast.classList.remove("show");
      toastRemoveTimer = setTimeout(() => el.toast.classList.add("hidden"), 200);
    }, duration);
  }
}

function hideToast() {
  clearTimeout(toastHideTimer);
  clearTimeout(toastRemoveTimer);
  el.toast.classList.remove("show");
  toastRemoveTimer = setTimeout(() => el.toast.classList.add("hidden"), 200);
}

// ---------- Colorful placeholder art for songs with no cover art ----------
// Same track name always hashes to the same gradient, so an untagged song
// looks consistent every time instead of showing an identical gray icon.
const NOTE_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="6.5" cy="18.5" r="2.5" fill="white"/>
  <circle cx="16.5" cy="16.5" r="2.5" fill="white"/>
  <path d="M9 18.5V4.5L19 2.5V16.5" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function gradientForName(name) {
  const h = hashString((name || "untitled").toLowerCase().trim());
  const hue1 = h % 360;
  const hue2 = (hue1 + 26 + (h % 44)) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 58% 40%), hsl(${hue2} 62% 22%))`;
}

function paintFallbackArt(track) {
  const gradient = gradientForName(track.name);
  el.miniArtFallback.style.background = gradient;
  el.miniArtFallback.innerHTML = NOTE_SVG;
  el.fullArtFallback.style.background = gradient;
  el.fullArtFallback.innerHTML = NOTE_SVG;
}

// ---------- Multi-select (main folder view only — long-press or ☑️) ----------
// Deliberately scoped to the main folder browser (#file-list), not Search or
// a playlist's detail view: those already have their own per-track "add to
// playlist" via the row menu, and selection state here is tied to
// currentFolders/currentTracks (see openFolder below), which only exist for
// the main view. Keeping it scoped avoids touching that other code at all.
const LONG_PRESS_MS = 480;
let selectMode = false;
const selectedItems = new Map(); // "folder:id" | "track:id" -> { type, id, name, data }

function selectKey(type, id) {
  return type + ":" + id;
}

// Wires press-and-hold on a row: shows a sweeping fill while held (cancels
// cleanly on early release or on scroll-intent movement), then fires
// onLongPress once the threshold is reached. Returns a function the row's
// own click handler must call first — it reports (and consumes) whether
// this click was actually the tail end of a long press, so that release
// doesn't also trigger the row's normal tap action.
function setupLongPress(row, onLongPress) {
  let timer = null;
  let firing = false;
  let cancelResetTimer = null;
  let startX = 0;
  let startY = 0;

  row.addEventListener("pointerdown", (e) => {
    if (selectMode || e.target.closest(".row-menu-btn")) return;
    firing = false;
    startX = e.clientX;
    startY = e.clientY;
    row.classList.remove("press-cancel");
    clearTimeout(cancelResetTimer);
    requestAnimationFrame(() => row.classList.add("pressing"));
    timer = setTimeout(() => {
      firing = true;
      timer = null;
      row.classList.remove("pressing");
      if (navigator.vibrate) navigator.vibrate(12);
      onLongPress();
      row.classList.add("just-selected");
      setTimeout(() => row.classList.remove("just-selected"), 260);
    }, LONG_PRESS_MS);
  });

  row.addEventListener("pointermove", (e) => {
    if (!timer) return;
    if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) cancelPress();
  });

  function cancelPress() {
    clearTimeout(timer);
    timer = null;
    if (row.classList.contains("pressing")) {
      row.classList.remove("pressing");
      row.classList.add("press-cancel");
      cancelResetTimer = setTimeout(() => row.classList.remove("press-cancel"), 180);
    }
  }
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => row.addEventListener(ev, cancelPress));

  return () => {
    if (firing) {
      firing = false;
      return true; // consume — the row's click handler should ignore this tap
    }
    return false;
  };
}

function toggleItemSelection(type, id, name, data, row) {
  const key = selectKey(type, id);
  if (selectedItems.has(key)) {
    selectedItems.delete(key);
    row.classList.remove("selected");
  } else {
    selectedItems.set(key, { type, id, name, data });
    row.classList.add("selected");
  }
  if (selectedItems.size === 0) {
    exitSelectMode();
    return;
  }
  updateSelectBarUI();
}

function updateSelectBarUI() {
  const count = selectedItems.size;
  el.selectActionBar.classList.toggle("hidden", count === 0);
  el.selectCountLabel.textContent = `${count} selected`;
  el.selectHeaderLabel.textContent = count === 0 ? "Select items" : `${count} selected`;
  const totalSelectable = currentFolders.length + currentTracks.length;
  el.selectAllBtn.textContent = count >= totalSelectable && totalSelectable > 0 ? "Clear all" : "Select all";
}

function enterSelectMode() {
  if (selectMode) return;
  selectMode = true;
  el.fileList.classList.add("select-mode");
  el.topBar.classList.add("hidden");
  el.selectHeaderBar.classList.remove("hidden");
  el.nowPlayingBar.classList.add("select-mode-hidden");
  updateSelectBarUI();
}

function exitSelectMode() {
  if (!selectMode) return;
  selectMode = false;
  selectedItems.clear();
  document.querySelectorAll("#file-list .row.selected").forEach((r) => r.classList.remove("selected"));
  el.fileList.classList.remove("select-mode");
  el.topBar.classList.remove("hidden");
  el.selectHeaderBar.classList.add("hidden");
  el.nowPlayingBar.classList.remove("select-mode-hidden");
  el.selectActionBar.classList.add("hidden");
}

el.selectToggleBtn.addEventListener("click", () => {
  if (selectMode) exitSelectMode();
  else enterSelectMode();
});
el.selectCancelBtn.addEventListener("click", exitSelectMode);

el.selectAllBtn.addEventListener("click", () => {
  const totalSelectable = currentFolders.length + currentTracks.length;
  if (selectedItems.size >= totalSelectable && totalSelectable > 0) {
    exitSelectMode();
    return;
  }
  currentFolders.forEach((f) => selectedItems.set(selectKey("folder", f.id), { type: "folder", id: f.id, name: f.name, data: f }));
  currentTracks.forEach((t) => selectedItems.set(selectKey("track", t.id), { type: "track", id: t.id, name: t.name, data: t }));
  document.querySelectorAll("#file-list .row").forEach((r) => r.classList.add("selected"));
  updateSelectBarUI();
});

// Selected folders are stored as just their id/name — actual tracks are
// resolved lazily here via the same recursive walker "play this folder" /
// "add folder to playlist" already use, run across every selected folder in
// parallel. Selected tracks are used as-is.
async function resolveSelectedTracks() {
  const items = [...selectedItems.values()];
  const merged = items.filter((i) => i.type === "track").map((i) => i.data);
  const seen = new Set(merged.map((t) => t.id));
  const folderItems = items.filter((i) => i.type === "folder");
  const folderTrackLists = await Promise.all(folderItems.map((f) => collectTracksRecursive(f.id)));
  folderTrackLists.flat().forEach((t) => {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      merged.push(t);
    }
  });
  return merged;
}

el.selectShuffleBtn.addEventListener("click", async () => {
  const selectionCount = selectedItems.size;
  showToast(`Loading ${selectionCount} selection${selectionCount === 1 ? "" : "s"}…`);
  try {
    const tracks = await resolveSelectedTracks();
    exitSelectMode();
    if (tracks.length === 0) {
      showToast("No songs found in that selection");
      return;
    }
    const startIndex = Math.floor(Math.random() * tracks.length);
    setQueue(tracks, startIndex);
    if (!shuffleOn) toggleShuffle();
    playCurrent();
    showToast(`Shuffling ${tracks.length} song${tracks.length === 1 ? "" : "s"}`);
  } catch (err) {
    console.error(err);
    exitSelectMode();
    showToast("Couldn't load that selection");
  }
});

el.selectAddPlaylistBtn.addEventListener("click", async () => {
  const selectionCount = selectedItems.size;
  showToast(`Loading ${selectionCount} selection${selectionCount === 1 ? "" : "s"}…`);
  try {
    const tracks = await resolveSelectedTracks();
    exitSelectMode();
    if (tracks.length === 0) {
      showToast("No songs found in that selection");
      return;
    }
    openAddToPlaylistModal(tracks); // already accepts an array — see app.js above
  } catch (err) {
    console.error(err);
    exitSelectMode();
    showToast("Couldn't load that selection");
  }
});

// ---------- Reusable track row ----------
// Lists stay fast: only shows an artist line when OneDrive already gave us
// one for free as part of the folder listing (no extra fetch). When it's
// missing, we just omit the line instead of showing a placeholder on every
// row — the real tag is read (for the currently playing track only) in
// id3.js, see player.onRealTags.
const EQUALIZER_ICON = `<span class="row-icon playing"><span class="bar"></span><span class="bar"></span><span class="bar"></span></span>`;
const NOTE_ICON = `<span class="row-icon">🎵</span>`;

// `selectable` opts a row into the multi-select gesture — only the main
// folder view's tracks pass this; Search results and a playlist's detail
// list render the exact same rows they always have.
function trackRow(track, { onPlay, onMenu, selectable = false, reorderable = false }) {
  const row = document.createElement("div");
  const isPlaying = !!(queue[queueIndex] && queue[queueIndex].id === track.id);
  row.className = "row track-row" + (isPlaying ? " now-playing-row" : "");
  row.dataset.trackId = track.id;
  const artist = track.audio && track.audio.artist;
  const key = selectKey("track", track.id);
  row.innerHTML = `
    <span class="row-lead">
      ${isPlaying ? EQUALIZER_ICON : NOTE_ICON}
      <span class="select-check"><span class="circle">✓</span></span>
    </span>
    <div class="row-text">
      <div class="row-name">${escapeHtml(track.name.replace(/\.[^/.]+$/, ""))}</div>
      ${artist ? `<div class="row-sub">${escapeHtml(artist)}</div>` : ""}
    </div>
    <button class="row-menu-btn">⋮</button>
    ${reorderable ? `<span class="drag-handle">☰</span>` : ""}
  `;
  if (selectable && selectedItems.has(key)) row.classList.add("selected");

  const wasLongPress = selectable ? setupLongPress(row, () => {
    if (!selectMode) enterSelectMode();
    toggleItemSelection("track", track.id, track.name, track, row);
  }) : () => false;

  row.addEventListener("click", (e) => {
    if (e.target.closest(".row-menu-btn, .drag-handle")) return;
    if (wasLongPress()) return;
    if (selectable && selectMode) {
      toggleItemSelection("track", track.id, track.name, track, row);
      return;
    }
    onPlay();
  });
  row.querySelector(".row-menu-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    onMenu();
  });
  return row;
}

// Keeps already-rendered rows in sync when the playing track changes without
// the list itself being re-rendered (e.g. skipping next/previous while
// looking at the same folder/search results/playlist).
function updateNowPlayingRows() {
  const currentId = queue[queueIndex] && queue[queueIndex].id;
  document.querySelectorAll(".track-row").forEach((row) => {
    const isPlaying = row.dataset.trackId === currentId;
    const wasPlaying = row.classList.contains("now-playing-row");
    if (isPlaying === wasPlaying) return;
    row.classList.toggle("now-playing-row", isPlaying);
    const icon = row.querySelector(".row-icon");
    if (icon) icon.outerHTML = isPlaying ? EQUALIZER_ICON : NOTE_ICON;
  });
}

// ---------- Main view: folder navigation, rooted at the chosen music folder ----------
let folderStack = [];
let currentTracks = [];
let currentFolders = [];

function renderBreadcrumb() {
  el.breadcrumb.innerHTML = "";
  folderStack.forEach((folder, i) => {
    const btn = document.createElement("button");
    btn.className = "crumb";
    btn.textContent = folder.name;
    btn.addEventListener("click", () => {
      folderStack = folderStack.slice(0, i + 1);
      openFolder(folder.id, false);
    });
    el.breadcrumb.appendChild(btn);
    if (i < folderStack.length - 1) {
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = "›";
      el.breadcrumb.appendChild(sep);
    }
  });
}

// Walks a folder and every subfolder beneath it (any depth), collecting all
// audio files — used for "play this folder" / "add folder to playlist" and
// the shuffle-everything button. Same bounded-concurrency walker as the
// search index scan (see runWithConcurrency in library.js), just scoped to
// one folder instead of the whole library.
async function collectTracksRecursive(folderId) {
  const tracks = [];
  await runWithConcurrency(5, [folderId], async (id) => {
    // Retried the same as every other folder listing in the app — without
    // this, one flaky request anywhere in a wide folder tree would abort the
    // whole "play this folder" / "add to playlist" action outright instead
    // of just riding out the blip.
    const { folders, tracks: folderTracks } = await retryWithBackoff(() => listFolder(id));
    tracks.push(...folderTracks);
    return folders.map((f) => f.id);
  });
  return tracks;
}

let pendingFolderForActions = null;

function openFolderActionsModal(folder) {
  pendingFolderForActions = folder;
  el.folderActionsTitle.textContent = folder.name;
  el.folderActionsModal.classList.remove("hidden");
}

async function openFolder(folderId, pushToStack, folderName) {
  // Selection is scoped to whatever folder is currently shown (see
  // currentFolders/currentTracks below) — navigating away would leave it
  // pointing at rows that no longer exist, so just close it out first.
  if (selectMode) exitSelectMode();
  if (pushToStack) folderStack.push({ id: folderId, name: folderName });
  renderBreadcrumb();
  el.statusMsg.innerHTML = `<span class="spinner"></span>Loading…`;
  el.fileList.innerHTML = "";
  // Bad/spotty signal (as opposed to navigator.onLine going false) tends to
  // fail an individual request rather than reliably — retry a few times with
  // backoff instead of dead-ending on one attempt. isStillHere() guards
  // against applying a stale retry's result after the user has since
  // navigated to a different folder.
  const isStillHere = () => folderStack[folderStack.length - 1]?.id === folderId;
  try {
    const { folders, tracks } = await retryWithBackoff(() => listFolder(folderId), {
      onRetry: (attempt) => {
        if (isStillHere()) el.statusMsg.innerHTML = `<span class="spinner"></span>Connection trouble — retrying (${attempt})…`;
      },
    });
    if (!isStillHere()) return;
    currentTracks = tracks;
    currentFolders = folders;
    el.statusMsg.textContent = folders.length + tracks.length === 0 ? "This folder is empty." : "";

    folders.forEach((folder) => {
      const row = document.createElement("div");
      row.className = "row folder-row";
      row.innerHTML = `
        <span class="row-lead">
          <span class="row-icon">📁</span>
          <span class="select-check"><span class="circle">✓</span></span>
        </span>
        <span class="row-name">${escapeHtml(folder.name)}</span>
        <button class="row-menu-btn">⋮</button>
      `;

      const wasLongPress = setupLongPress(row, () => {
        if (!selectMode) enterSelectMode();
        toggleItemSelection("folder", folder.id, folder.name, folder, row);
      });

      row.addEventListener("click", (e) => {
        if (e.target.closest(".row-menu-btn")) return;
        if (wasLongPress()) return;
        if (selectMode) {
          toggleItemSelection("folder", folder.id, folder.name, folder, row);
          return;
        }
        openFolder(folder.id, true, folder.name);
      });
      row.querySelector(".row-menu-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        openFolderActionsModal(folder);
      });
      el.fileList.appendChild(row);
    });

    tracks.forEach((track, index) => {
      el.fileList.appendChild(
        trackRow(track, {
          selectable: true,
          onPlay: () => {
            setQueue(currentTracks, index);
            playCurrent();
          },
          onMenu: () => openAddToPlaylistModal(track),
        })
      );
    });

    // Quietly warm each subfolder's own contents in the background (low
    // priority, bounded concurrency — same pattern as the library scan) so
    // that if you tap into one next, it's likely already cached instead of
    // needing its own fresh network round trip. One level deep only — this
    // is "prefetch what's visible right now", not a second library scan.
    // Fire-and-forget: never awaited, and listFolder's own folderListCache
    // already de-dupes this against anything the scan is doing in parallel.
    runWithConcurrency(5, folders.map((f) => f.id), (id) =>
      listFolder(id, { priority: "low" }).then(() => undefined).catch(() => undefined)
    );
  } catch (err) {
    console.error(err);
    if (isStillHere()) el.statusMsg.textContent = "Couldn't load this folder. Check your connection and try again.";
  }
}

function openMainFolderView(stack) {
  folderStack = stack;
  openFolder(folderStack[folderStack.length - 1].id, false);
}

// ---------- Library scan (powers Search only — the main view is folder browsing) ----------
// Tracks an in-progress scan so every caller (the automatic one on app open,
// and Search opening before it's finished) shares the same attempt instead
// of each kicking off its own — that was the cause of a second "Scanning…"
// toast firing if you opened Search while the automatic scan was still running.
let libraryLoadPromise = null;

async function ensureLibraryLoaded() {
  if (libraryLoaded) return;
  if (libraryLoadPromise) {
    await libraryLoadPromise; // already running — just wait for it, don't start another
    return;
  }
  if (loadCachedLibrary()) {
    libraryLoaded = true;
    return;
  }
  libraryLoadPromise = rescanLibrary().finally(() => {
    libraryLoadPromise = null;
  });
  await libraryLoadPromise;
}

// Mirrors scan progress into whichever of Settings / Search is currently
// open (or both), so they never show different or stale info.
function setScanProgressUI(html) {
  el.scanStatus.innerHTML = html;
  if (!el.searchOverlay.classList.contains("hidden") && !el.searchInput.value.trim()) {
    el.searchResults.innerHTML = `<p class="status-msg">${html}</p>`;
  }
}

async function rescanLibrary() {
  clearFolderListCache(); // otherwise "rescan" would just re-read cached folder data
  showToast("Scanning your music for search…");
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
    if (!el.searchOverlay.classList.contains("hidden") && !el.searchInput.value.trim()) {
      el.searchResults.innerHTML = "";
    }
    showToast(`Search ready — ${finalFolderCount} folder${finalFolderCount === 1 ? "" : "s"}, ${libraryTracks.length} song${libraryTracks.length === 1 ? "" : "s"} found`);
  } catch (err) {
    console.error(err);
    el.scanStatus.textContent = "Scan failed: " + (err.message || err);
    if (!el.searchOverlay.classList.contains("hidden") && !el.searchInput.value.trim()) {
      el.searchResults.innerHTML = `<p class="status-msg">Couldn't finish scanning your library.</p>`;
    }
    showToast("Couldn't finish scanning your library");
  }
}

// ---------- Detail overlay (playlist tracklists) ----------
function openDetailList(title, tracks, playlistId) {
  el.detailTitle.textContent = title;
  el.detailList.innerHTML = "";
  el.detailHeaderActions.classList.toggle("hidden", tracks.length === 0);
  el.detailPlayBtn.onclick = () => {
    setQueue(tracks, 0);
    if (shuffleOn) toggleShuffle();
    playCurrent();
  };
  el.detailShuffleBtn.onclick = () => {
    const startIndex = Math.floor(Math.random() * tracks.length);
    setQueue(tracks, startIndex);
    if (!shuffleOn) toggleShuffle();
    playCurrent();
  };
  if (tracks.length === 0) {
    el.detailList.innerHTML = `<p class="status-msg">No songs${playlistId ? " in this playlist yet." : "."}</p>`;
  }
  tracks.forEach((track, index) => {
    el.detailList.appendChild(
      trackRow(track, {
        onPlay: () => {
          setQueue(tracks, index);
          playCurrent();
        },
        onMenu: () => {
          if (playlistId) {
            if (confirm(`Remove "${track.name.replace(/\.[^/.]+$/, "")}" from this playlist?`)) {
              removeTrackFromPlaylist(playlistId, track.id);
              const updated = loadPlaylists().find((p) => p.id === playlistId);
              openDetailList(title, updated ? updated.tracks : [], playlistId);
              renderPlaylistsList();
            }
          } else {
            openAddToPlaylistModal(track);
          }
        },
      })
    );
  });
  el.detailOverlay.classList.remove("hidden");
}

el.detailBackBtn.addEventListener("click", () => el.detailOverlay.classList.add("hidden"));

// Drag-to-reorder the "Up Next" queue via each row's dedicated handle (never
// the row itself, so it never fights with tap-to-play or the ⋮ menu). Rows
// are swapped live in the DOM as the dragged row crosses a neighbor's
// midpoint. Session-only — reorders playOrder in memory, nothing persisted.
//
// The compensation added to startClientY after a swap must match the
// height of whichever row it just swapped with, NOT the dragged row's own
// height — rows can differ in height (an artist subtitle line makes a row
// taller), and using a single fixed height there was what caused the drag
// to visibly desync/"resize" itself further with every swap.
//
// Move/end listeners live on window rather than using setPointerCapture on
// the handle — the live DOM reorder below (insertBefore) relocates the
// dragged row, and some WebViews silently release pointer capture when the
// captured element (or an ancestor) gets reparented mid-gesture. Once that
// happens pointerup never arrives, so the drag never "ends": the row is
// left stuck with its in-progress transform, showing as a displaced/blank
// row until the app is reloaded. window-level listeners don't depend on
// capture surviving a reparent, so they keep receiving events regardless.
function enableQueueDragReorder(container) {
  container.querySelectorAll(".drag-handle").forEach((handle) => {
    handle.addEventListener("pointerdown", (e) => {
      const dragRow = handle.closest(".track-row");
      const dragHeight = dragRow.getBoundingClientRect().height;
      let startClientY = e.clientY;
      dragRow.classList.add("dragging");

      const onMove = (ev) => {
        const dy = ev.clientY - startClientY;
        dragRow.style.transform = `translateY(${dy}px)`;
        const rows = Array.from(container.querySelectorAll(".track-row"));
        const index = rows.indexOf(dragRow);
        const dragMid = dragRow.getBoundingClientRect().top + dragHeight / 2;

        if (dy < 0) {
          const prev = rows[index - 1];
          if (prev) {
            const prevRect = prev.getBoundingClientRect();
            if (dragMid < prevRect.top + prevRect.height / 2) {
              container.insertBefore(dragRow, prev);
              startClientY -= prevRect.height;
            }
          }
        } else {
          const next = rows[index + 1];
          if (next) {
            const nextRect = next.getBoundingClientRect();
            if (dragMid > nextRect.top + nextRect.height / 2) {
              container.insertBefore(dragRow, next.nextSibling);
              startClientY += nextRect.height;
            }
          }
        }
      };

      const onEnd = () => {
        dragRow.style.transform = "";
        dragRow.classList.remove("dragging");
        const orderedIds = Array.from(container.querySelectorAll(".track-row")).map((row) => row.dataset.trackId);
        const orderedQueueIndices = orderedIds.map((id) => queue.findIndex((t) => t.id === id));
        setUpcomingOrder(orderedQueueIndices);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    });
  });
}

// ---------- Folder picker (first-run onboarding + "change folder" from Settings) ----------
let fpStack = [{ id: "root", name: "OneDrive" }];

function renderFpBreadcrumb() {
  el.fpBreadcrumb.innerHTML = "";
  fpStack.forEach((folder, i) => {
    const btn = document.createElement("button");
    btn.className = "crumb";
    btn.textContent = folder.name;
    btn.addEventListener("click", () => {
      fpStack = fpStack.slice(0, i + 1);
      loadFpFolder(folder.id);
    });
    el.fpBreadcrumb.appendChild(btn);
    if (i < fpStack.length - 1) {
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = "›";
      el.fpBreadcrumb.appendChild(sep);
    }
  });
}

async function loadFpFolder(folderId) {
  renderFpBreadcrumb();
  el.fpFileList.innerHTML = `<p class="status-msg"><span class="spinner"></span>Loading…</p>`;
  const isStillHere = () => fpStack[fpStack.length - 1]?.id === folderId;
  try {
    const { folders, tracks } = await retryWithBackoff(() => listFolder(folderId), {
      onRetry: (attempt) => {
        if (isStillHere()) {
          el.fpFileList.innerHTML = `<p class="status-msg"><span class="spinner"></span>Connection trouble — retrying (${attempt})…</p>`;
        }
      },
    });
    if (!isStillHere()) return;
    el.fpFileList.innerHTML = "";
    if (folders.length === 0) {
      el.fpFileList.innerHTML = `<p class="status-msg">No subfolders here.</p>`;
    }
    folders.forEach((folder) => {
      const row = document.createElement("div");
      row.className = "row folder-row";
      row.innerHTML = `<span class="row-icon">📁</span><span class="row-name">${escapeHtml(folder.name)}</span>`;
      row.addEventListener("click", () => {
        fpStack.push({ id: folder.id, name: folder.name });
        loadFpFolder(folder.id);
      });
      el.fpFileList.appendChild(row);
    });
    const current = fpStack[fpStack.length - 1];
    el.fpUseHereBtn.textContent = `✓ Use "${current.name}" (${tracks.length} song${tracks.length === 1 ? "" : "s"} here)`;
  } catch (err) {
    console.error(err);
    if (isStillHere()) {
      el.fpFileList.innerHTML = `<p class="status-msg">Couldn't load this folder. Check your connection and try again.</p>`;
    }
  }
}

function openFolderPicker(mode) {
  fpStack = [{ id: "root", name: "OneDrive" }];
  el.folderPickerCancelBtn.classList.toggle("hidden", mode !== "change");
  el.folderPickerHeading.textContent = mode === "onboarding" ? "Select your music folder" : "Change music folder";
  // The mini player sits above overlays (z-index 25 vs 20) so it stays
  // visible over search/settings/etc — but here it would float directly on
  // top of the "Use this folder" button and eat its taps. Hide it for the
  // duration, same trick used for select mode.
  el.nowPlayingBar.classList.add("select-mode-hidden");
  el.folderPickerOverlay.classList.remove("hidden");
  loadFpFolder("root");
}

function closeFolderPicker() {
  el.folderPickerOverlay.classList.add("hidden");
  el.nowPlayingBar.classList.remove("select-mode-hidden");
}

el.fpHomeBtn.addEventListener("click", () => {
  fpStack = [{ id: "root", name: "OneDrive" }];
  loadFpFolder("root");
});

el.fpUseHereBtn.addEventListener("click", () => {
  // Only the chosen folder itself becomes the main view's navigation root —
  // not the whole path used to browse there. Otherwise back-navigation would
  // keep stepping up through OneDrive's root and any folders in between
  // before ever reaching the exit confirmation.
  const chosen = fpStack[fpStack.length - 1];
  setLibraryFolder(chosen);
  closeFolderPicker();
  openMainFolderView([chosen]);
  ensureLibraryLoaded(); // covers first-time folder selection and later changes, not just later app opens
});

el.folderPickerCancelBtn.addEventListener("click", () => {
  closeFolderPicker();
});

function setLibraryFolder(folder) {
  localStorage.setItem(DEFAULT_FOLDER_KEY, JSON.stringify([folder]));
  localStorage.removeItem(LIBRARY_CACHE_KEY);
  libraryLoaded = false;
}

// ---------- Playlists ----------
function renderPlaylistsList() {
  const playlists = loadPlaylists();
  el.playlistsList.innerHTML = "";
  if (playlists.length === 0) {
    el.playlistsList.innerHTML = `<p class="status-msg">No playlists yet. Tap "+ New Playlist" to create one.</p>`;
    return;
  }
  playlists.forEach((pl) => {
    const row = document.createElement("div");
    row.className = "row";
    const icon = pl.id === FAVORITES_PLAYLIST_ID ? "❤️" : "📃";
    row.innerHTML = `
      <span class="row-icon">${icon}</span>
      <div class="row-text">
        <div class="row-name">${escapeHtml(pl.name)}</div>
        <div class="row-sub">${pl.tracks.length} song${pl.tracks.length === 1 ? "" : "s"}</div>
      </div>
      <button class="row-menu-btn">⋮</button>
    `;
    row.addEventListener("click", (e) => {
      if (e.target.closest(".row-menu-btn")) return;
      openDetailList(pl.name, pl.tracks, pl.id);
    });
    row.querySelector(".row-menu-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openPlaylistActionsModal(pl);
    });
    el.playlistsList.appendChild(row);
  });
}

// ---------- Playlist actions (3-dot menu on a playlist row: rename/delete) ----------
let pendingPlaylistForActions = null;

function openPlaylistActionsModal(playlist) {
  pendingPlaylistForActions = playlist;
  el.playlistActionsTitle.textContent = playlist.name;
  const isFavorites = playlist.id === FAVORITES_PLAYLIST_ID;
  // Favorites is a fixed system playlist — no renaming, no deleting, only
  // clearing it out.
  el.playlistRenameBtn.classList.toggle("hidden", isFavorites);
  el.playlistDeleteBtn.classList.toggle("hidden", isFavorites);
  el.playlistClearBtn.classList.toggle("hidden", !isFavorites);
  el.playlistActionsModal.classList.remove("hidden");
}

el.playlistActionsCancelBtn.addEventListener("click", () => el.playlistActionsModal.classList.add("hidden"));

el.playlistRenameBtn.addEventListener("click", () => {
  el.playlistActionsModal.classList.add("hidden");
  const playlist = pendingPlaylistForActions;
  if (!playlist) return;
  const name = prompt("Rename playlist:", playlist.name);
  if (name && name.trim() && name.trim() !== playlist.name) {
    renamePlaylist(playlist.id, name.trim());
    renderPlaylistsList();
  }
});

el.playlistDeleteBtn.addEventListener("click", () => {
  el.playlistActionsModal.classList.add("hidden");
  const playlist = pendingPlaylistForActions;
  if (!playlist) return;
  if (confirm(`Delete playlist "${playlist.name}"?`)) {
    deletePlaylist(playlist.id);
    renderPlaylistsList();
  }
});

el.playlistClearBtn.addEventListener("click", () => {
  el.playlistActionsModal.classList.add("hidden");
  const playlist = pendingPlaylistForActions;
  if (!playlist) return;
  if (confirm(`Remove all songs from "${playlist.name}"? The playlist itself will stay, just empty.`)) {
    clearPlaylist(playlist.id);
    renderPlaylistsList();
  }
});

el.playlistsBtn.addEventListener("click", () => {
  renderPlaylistsList();
  el.playlistsOverlay.classList.remove("hidden");
});
el.playlistsCloseBtn.addEventListener("click", () => el.playlistsOverlay.classList.add("hidden"));

el.newPlaylistBtn.addEventListener("click", () => {
  const name = prompt("Playlist name:");
  if (name && name.trim()) {
    createPlaylist(name.trim());
    renderPlaylistsList();
  }
});

// ---------- Add-to-playlist modal ----------
// Accepts a single track or an array (e.g. every song found under a folder).
function openAddToPlaylistModal(trackOrTracks) {
  pendingTracksForPlaylist = Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks];
  const playlists = loadPlaylists();
  el.addPlaylistList.innerHTML = "";
  if (playlists.length === 0) {
    el.addPlaylistList.innerHTML = `<p class="status-msg">No playlists yet — create one below.</p>`;
  }
  playlists.forEach((pl) => {
    const row = document.createElement("div");
    row.className = "row";
    const icon = pl.id === FAVORITES_PLAYLIST_ID ? "❤️" : "📃";
    row.innerHTML = `<span class="row-icon">${icon}</span><span class="row-name">${escapeHtml(pl.name)}</span>`;
    row.addEventListener("click", () => {
      const added = addTracksToPlaylist(pl.id, pendingTracksForPlaylist);
      el.addPlaylistModal.classList.add("hidden");
      showToast(added === 1 ? `Added to "${pl.name}"` : `Added ${added} songs to "${pl.name}"`);
    });
    el.addPlaylistList.appendChild(row);
  });
  el.addPlaylistModal.classList.remove("hidden");
}

el.addPlaylistNewBtn.addEventListener("click", () => {
  const name = prompt("Playlist name:");
  if (name && name.trim()) {
    const pl = createPlaylist(name.trim());
    const added = addTracksToPlaylist(pl.id, pendingTracksForPlaylist);
    el.addPlaylistModal.classList.add("hidden");
    showToast(added === 1 ? `Added to "${pl.name}"` : `Added ${added} songs to "${pl.name}"`);
  }
});
el.addPlaylistCancelBtn.addEventListener("click", () => el.addPlaylistModal.classList.add("hidden"));

// ---------- Folder actions (3-dot menu on a folder row) ----------
el.folderActionsCancelBtn.addEventListener("click", () => el.folderActionsModal.classList.add("hidden"));

el.folderPlayBtn.addEventListener("click", async () => {
  el.folderActionsModal.classList.add("hidden");
  const folder = pendingFolderForActions;
  if (!folder) return;
  showToast(`Loading songs from "${folder.name}"…`);
  try {
    const tracks = await collectTracksRecursive(folder.id);
    if (tracks.length === 0) {
      showToast("No songs found in that folder");
      return;
    }
    const startIndex = Math.floor(Math.random() * tracks.length);
    setQueue(tracks, startIndex);
    if (!shuffleOn) toggleShuffle();
    playCurrent();
    showToast(`Shuffling ${tracks.length} song${tracks.length === 1 ? "" : "s"} from "${folder.name}"`);
  } catch (err) {
    console.error(err);
    showToast("Couldn't load that folder's songs");
  }
});

el.folderAddPlaylistBtn.addEventListener("click", async () => {
  el.folderActionsModal.classList.add("hidden");
  const folder = pendingFolderForActions;
  if (!folder) return;
  showToast(`Loading songs from "${folder.name}"…`);
  try {
    const tracks = await collectTracksRecursive(folder.id);
    if (tracks.length === 0) {
      showToast("No songs found in that folder");
      return;
    }
    openAddToPlaylistModal(tracks);
  } catch (err) {
    console.error(err);
    showToast("Couldn't load that folder's songs");
  }
});

// Shuffle-plays everything under whatever folder you're currently looking at
// — its own songs plus every song in every subfolder shown, no matter how
// deep. No confirmation dialog: the loading toast already makes clear
// something's about to happen, and it's one tap to undo (just play something
// else), so a blocking yes/no felt like unnecessary friction for what's
// meant to be a quick "shuffle everything" action.
el.shuffleViewBtn.addEventListener("click", async () => {
  const folder = folderStack[folderStack.length - 1];
  if (!folder) return;
  showToast(`Loading songs from "${folder.name}"…`);
  try {
    const tracks = await collectTracksRecursive(folder.id);
    if (tracks.length === 0) {
      showToast("No songs found here");
      return;
    }
    const startIndex = Math.floor(Math.random() * tracks.length);
    setQueue(tracks, startIndex);
    if (!shuffleOn) toggleShuffle();
    playCurrent();
    showToast(`Shuffling ${tracks.length} song${tracks.length === 1 ? "" : "s"} from "${folder.name}"`);
  } catch (err) {
    console.error(err);
    showToast("Couldn't load songs to shuffle");
  }
});

// ---------- Search ----------
el.searchBtn.addEventListener("click", async () => {
  el.searchOverlay.classList.remove("hidden");
  el.searchInput.value = "";
  el.searchResults.innerHTML = "";
  el.searchInput.focus();
  if (!libraryLoaded) {
    // rescanLibrary()'s onProgress (via setScanProgressUI) takes over showing
    // live progress here now, same text as Settings, since the overlay is open.
    await ensureLibraryLoaded();
    if (!el.searchInput.value.trim()) el.searchResults.innerHTML = "";
  }
});
el.searchCloseBtn.addEventListener("click", () => el.searchOverlay.classList.add("hidden"));
let searchDebounceTimer = null;
el.searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(runSearch, 150);
});

function runSearch() {
  const query = el.searchInput.value;
  const results = searchLibrary(query);
  el.searchResults.innerHTML = "";
  if (query.trim() && results.length === 0) {
    el.searchResults.innerHTML = `<p class="status-msg">No matches.</p>`;
  }
  results.forEach((track, index) => {
    el.searchResults.appendChild(
      trackRow(track, {
        onPlay: () => {
          setQueue(results, index);
          playCurrent();
        },
        onMenu: () => openAddToPlaylistModal(track),
      })
    );
  });
}

// ---------- Settings ----------
// ---------- Color themes ----------
// Every color in css/style.css is a custom property under :root/:root[data-
// theme=...] (see the block at the top of that file) — switching themes is
// just swapping which block is active, one attribute write. That's a single
// repaint of already-visible pixels, not a layout pass, so it costs nothing
// worth measuring (nothing here runs per-frame or continuously either way).
const THEME_KEY = "colorTheme";
const THEMES = [
  { id: "midnight", name: "Midnight", bg: "#121212", accent: "#1db954" },
  { id: "ocean", name: "Deep Ocean", bg: "#0f1720", accent: "#3ea6ff" },
  { id: "ember", name: "Sunset Ember", bg: "#1c1210", accent: "#ff8a5c" },
  { id: "violet", name: "Violet Nights", bg: "#160f1e", accent: "#b280ff" },
  { id: "daylight", name: "Daylight", bg: "#f6f7f8", accent: "#0f6b35" },
];

function getSavedTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return THEMES.some((t) => t.id === saved) ? saved : "midnight";
  } catch {
    return "midnight";
  }
}

function applyTheme(id) {
  const theme = THEMES.find((t) => t.id === id) || THEMES[0];
  document.documentElement.setAttribute("data-theme", theme.id);
  try {
    localStorage.setItem(THEME_KEY, theme.id);
  } catch {}
  // Matches the browser chrome / status bar to the theme too.
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) metaThemeColor.setAttribute("content", theme.bg);
}

function renderThemeList() {
  const current = getSavedTheme();
  el.themeList.innerHTML = "";
  THEMES.forEach((theme) => {
    const isActive = theme.id === current;
    const row = document.createElement("div");
    row.className = "row theme-row" + (isActive ? " theme-row-active" : "");
    row.innerHTML = `
      <span class="theme-swatch" style="background:${theme.bg}"><span class="theme-swatch-accent" style="background:${theme.accent}"></span></span>
      <div class="row-text"><div class="row-name">${theme.name}</div></div>
      ${isActive ? '<span class="theme-check">✓</span>' : ""}
    `;
    row.addEventListener("click", () => {
      if (isActive) return;
      applyTheme(theme.id);
      renderThemeList();
    });
    el.themeList.appendChild(row);
  });
}

// The inline script in index.html's <head> already set data-theme before
// first paint (avoiding a flash of the wrong theme) — this just catches the
// status-bar meta tag up to match, which that early script deliberately
// skips (it doesn't need the THEMES list, so it does the least work possible
// pre-paint).
applyTheme(getSavedTheme());

el.settingsBtn.addEventListener("click", () => {
  el.libraryRootLabel.textContent = getLibraryRootLabel();
  // Don't clear scanStatus here — it already reflects reality (blank if
  // never scanned, live progress if scanning, or the "Done" summary), and
  // wiping it was erasing the auto-scan's result the moment you opened
  // Settings to go check it.
  renderThemeList();
  el.settingsOverlay.classList.remove("hidden");
});
el.settingsCloseBtn.addEventListener("click", () => el.settingsOverlay.classList.add("hidden"));
el.rescanLibraryBtn.addEventListener("click", () => rescanLibrary());
el.changeFolderBtn.addEventListener("click", () => {
  el.settingsOverlay.classList.add("hidden");
  openFolderPicker("change");
});

// ---------- Backup / restore (playlists + search index) ----------
// Purely on-demand — only runs when you tap the button, never automatically,
// so it can't affect app speed. Safe to include the search index: it only
// stores each song's permanent OneDrive id, never the short-lived streaming
// link, so nothing in the backup can go stale.
function exportBackup() {
  let libraryCache = null;
  try {
    const raw = localStorage.getItem(LIBRARY_CACHE_KEY);
    libraryCache = raw ? JSON.parse(raw) : null;
  } catch {
    libraryCache = null;
  }

  const backup = {
    type: "musicplayer-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    playlists: loadPlaylists(),
    libraryCache,
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `musicplayer-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Backup saved");
}

function importBackupFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const backup = JSON.parse(reader.result);
      let addedPlaylists = 0;
      if (Array.isArray(backup.playlists)) {
        const existing = loadPlaylists();
        const existingIds = new Set(existing.map((p) => p.id));
        const newOnes = backup.playlists.filter((p) => p && p.id && !existingIds.has(p.id));
        addedPlaylists = newOnes.length;
        savePlaylists(existing.concat(newOnes));
      }
      if (backup.libraryCache) {
        localStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify(backup.libraryCache));
        libraryLoaded = false; // picked up fresh next time Search/library is touched, if the root folder still matches
      }
      showToast(`Restored — ${addedPlaylists} playlist${addedPlaylists === 1 ? "" : "s"} added`);
    } catch (err) {
      console.error("Restore failed", err);
      showToast("Couldn't read that backup file");
    }
  };
  reader.readAsText(file);
}

el.backupBtn.addEventListener("click", exportBackup);
el.restoreBtn.addEventListener("click", () => el.restoreFileInput.click());
el.restoreFileInput.addEventListener("change", () => {
  const file = el.restoreFileInput.files[0];
  if (file) importBackupFile(file);
  el.restoreFileInput.value = ""; // reset so selecting the same file again still fires "change"
});

// ---------- Error log (Settings > View error log) ----------
function renderErrorLog() {
  const log = loadErrorLog();
  el.errorLogList.innerHTML = "";
  if (log.length === 0) {
    el.errorLogList.innerHTML = `<p class="status-msg">No errors logged.</p>`;
    return;
  }
  log.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "error-log-row";
    const time = new Date(entry.time).toLocaleString();
    row.innerHTML = `
      <div class="error-log-time">${escapeHtml(time)}</div>
      <div class="error-log-message">${escapeHtml(entry.message)}</div>
    `;
    el.errorLogList.appendChild(row);
  });
}

el.errorLogBtn.addEventListener("click", () => {
  renderErrorLog();
  el.errorLogOverlay.classList.remove("hidden");
});
el.errorLogBackBtn.addEventListener("click", () => el.errorLogOverlay.classList.add("hidden"));
el.errorLogClearBtn.addEventListener("click", () => {
  clearErrorLog();
  renderErrorLog();
});
el.errorLogCopyBtn.addEventListener("click", async () => {
  const log = loadErrorLog();
  const text = log.map((entry) => `[${new Date(entry.time).toLocaleString()}] ${entry.message}`).join("\n\n");
  try {
    await navigator.clipboard.writeText(text || "No errors logged.");
    showToast("Error log copied");
  } catch {
    showToast("Couldn't copy — clipboard unavailable");
  }
});

// ---------- Player UI bindings ----------
// Only tried once neither OneDrive's thumbnail nor the file's own embedded
// picture panned out — a fixed delay rather than precisely sequencing two
// independent async checks, since both normally settle well within this.
function applyRealArt(url) {
  el.miniArt.src = url;
  el.miniArt.classList.remove("hidden");
  el.miniArtFallback.classList.add("hidden");
  el.fullArt.src = url;
  el.fullArt.classList.remove("hidden");
  el.fullArtFallback.classList.add("hidden");
}

// Same scoring discipline as scoreLyricsCandidate/LYRICS_MATCH_THRESHOLD
// below — this used to just trust iTunes' top result blindly (limit=1, no
// verification), which for less mainstream genres (regional/vallenato etc.,
// where iTunes' catalog is thin) reliably returned some other band's cover
// entirely instead of admitting "no match" and falling back to the
// placeholder. Confirmed by a user report showing 4-5 confidently wrong
// covers in a row.
function scoreArtworkCandidate(candidate, wantTitle, wantArtist) {
  let score = 0;
  score += fieldMatchScore(wantTitle, candidate.trackName, 3, 1.5);
  score += fieldMatchScore(wantArtist, candidate.artistName, 3, 1.5);
  return score;
}

const ARTWORK_MATCH_THRESHOLD = 4; // same bar as lyrics — an exact title alone isn't enough without the artist agreeing too

// Last resort: look up the song by artist/title in Apple's public music
// catalog. This is the only art source that leaves the app/OneDrive — it's a
// best-effort text match, so several candidates are scored against what was
// actually asked for rather than trusting whichever one comes back first.
async function findOnlineArtwork(title, artist) {
  const cleanTitle = cleanTrackTitle(title);
  const cleanArtist = artist ? primaryArtist(artist) : "";
  const term = `${cleanArtist} ${cleanTitle}`.trim();
  if (!term) return null;
  try {
    const res = await fetch(`https://itunes.apple.com/search?media=music&limit=5&term=${encodeURIComponent(term)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const results = data.results || [];
    let best = null;
    let bestScore = -Infinity;
    for (const candidate of results) {
      const score = scoreArtworkCandidate(candidate, cleanTitle, cleanArtist);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best || bestScore < ARTWORK_MATCH_THRESHOLD || !best.artworkUrl100) return null;
    return best.artworkUrl100.replace("100x100", "600x600"); // ask for a bigger version than the default thumbnail
  } catch (err) {
    return null;
  }
}

// Skips a same-folder cover image on purpose — that was tried and dropped
// (a folder mixing multiple artists/albums means "some image in this
// folder" is often the WRONG cover, not a good guess).
async function tryOnlineArtFallback(item) {
  if (queue[queueIndex] !== item) return; // track changed since this was scheduled
  // Check what's actually on screen, not just whether OneDrive claimed to
  // have a thumbnail — a "found" thumbnail URL can still fail to load (that's
  // exactly why the error-fallback exists), so trusting that flag here was
  // skipping this check even when nothing had actually loaded.
  if (!el.fullArt.classList.contains("hidden")) return; // real art is genuinely showing

  const title = item.name.replace(/\.[^/.]+$/, "");
  const artist = (item.audio && item.audio.artist) || "";
  try {
    const url = await findOnlineArtwork(title, artist);
    if (url && queue[queueIndex] === item) {
      applyRealArt(url);
    }
  } catch (err) {
    console.error("Online art lookup failed", err);
  }
}

// Retriggers the CSS swap animation even on rapid consecutive track changes
// (e.g. spamming next/previous) — same remove/reflow/re-add trick as
// pulsePress(), since simply re-adding an already-present class wouldn't
// restart a CSS animation.
function pulseArtSwap(el) {
  el.classList.remove("art-swap-in");
  void el.offsetWidth;
  el.classList.add("art-swap-in");
}

player.onTrackChange = (item) => {
  el.nowPlayingBar.classList.remove("hidden");
  pulseArtSwap(el.npArt);
  pulseArtSwap(el.fullPlayerArt);
  const title = item.name.replace(/\.[^/.]+$/, "");
  const artist = (item.audio && item.audio.artist) || "OneDrive";
  el.nowPlayingTitle.textContent = title;
  el.nowPlayingArtist.textContent = artist;
  el.fullTitle.textContent = title;
  el.fullArtist.textContent = artist;
  updateNowPlayingRows();
  // Keeps the Up Next view honest if the track changes while it's already
  // open (e.g. skipping via the lock-screen/notification controls) — without
  // this, the overlay's DOM is left over from whenever it was last opened,
  // so the newly-current track would still show up in the reorderable
  // "Next up" list wearing the now-playing highlight instead of moving up
  // into "Now Playing" where it belongs.
  if (!el.upNextOverlay.classList.contains("hidden")) openUpNextView();
  // Cleared here, set in onRealTags below once the real embedded tag read
  // resolves for THIS track — lyrics matching prefers this over
  // item.audio.artist (see fetchLyricsResult), since that's the exact
  // title/artist actually shown on screen, not OneDrive's lighter metadata.
  currentRealTags = null;
  // A fresh promise per track that onRealTags resolves — lets a lyrics fetch
  // started before the real tag arrives wait for it once instead of firing
  // twice (fetch now with weak data, fetch again once better data shows up).
  realTagsPromise = new Promise((resolve) => {
    resolveRealTagsPromise = resolve;
  });

  el.miniArt.classList.add("hidden");
  el.miniArtFallback.classList.remove("hidden");
  el.fullArt.classList.add("hidden");
  el.fullArtFallback.classList.remove("hidden");
  paintFallbackArt(item);
  setTimeout(() => tryOnlineArtFallback(item), 2500);

  getThumbnailUrl(item.id).then((url) => {
    if (!url || queue[queueIndex] !== item) return;
    el.miniArt.src = url;
    el.miniArt.classList.remove("hidden");
    el.miniArtFallback.classList.add("hidden");
    el.fullArt.src = url;
    el.fullArt.classList.remove("hidden");
    el.fullArtFallback.classList.add("hidden");

    // Also show the art on the lock-screen/notification media controls.
    if ("mediaSession" in navigator && navigator.mediaSession.metadata) {
      navigator.mediaSession.metadata.artwork = [{ src: url, sizes: "512x512", type: "image/jpeg" }];
    }
  });

  // Lyrics view (if open) follows track changes rather than snapping back to
  // album art — same behavior as Spotify/Apple Music when you skip tracks
  // while reading along.
  if (lyricsViewActive) showLyricsForCurrentTrack();
};

// OneDrive's thumbnail metadata isn't always reliable (same gap we found
// with artist names) — sometimes it hands back a URL that doesn't actually
// load. Without this, a broken thumbnail would just sit there as the
// browser's native "broken image" icon instead of falling back to the
// colorful placeholder.
el.miniArt.addEventListener("error", () => {
  el.miniArt.classList.add("hidden");
  el.miniArtFallback.classList.remove("hidden");
});
el.fullArt.addEventListener("error", () => {
  el.fullArt.classList.add("hidden");
  el.fullArtFallback.classList.remove("hidden");
});

player.onPlayStateChange = (isPlaying) => {
  const symbol = isPlaying ? "⏸" : "▶";
  el.miniPlayPauseBtn.textContent = symbol;
  el.fullPlayPauseBtn.textContent = symbol;
  // Drives the equalizer-bar animation (CSS) on every "now playing" row
  // anywhere in the DOM at once — a single toggle here instead of hunting
  // down and re-rendering each row individually whenever play/pause changes.
  document.body.classList.toggle("audio-paused", !isPlaying);
};

// Toast rather than el.statusMsg (used below to be reserved for folder-load
// state) — el.statusMsg lives in the base view, underneath every overlay
// (Full Player included), so it's invisible during actual playback, which is
// exactly when this message matters. Toast is position:fixed above
// everything, so it's visible no matter what screen you're looking at.
// "Loading …" fires on every single track change (including normal
// skip/auto-advance, which is instant almost always) — toasting that too
// would pop up on every song. Only retry/error messages are worth
// interrupting for; routine loading has no toast at all.
//
// Persistent (no auto-hide) rather than a timed toast — a reconnect can take
// up to ~2 minutes across several retries, and a message that vanishes on
// its own 4-second timer partway through reads as "gave up" even though
// it's still actively retrying. It only goes away once onStatus("") fires
// (real success) or a new message replaces it.
player.onStatus = (message) => {
  if (!message) {
    hideToast();
    return;
  }
  if (message.startsWith("Loading")) return;
  showToast(message, null);
};

player.onTimeUpdate = (current, duration) => {
  el.fullCurrentTime.textContent = formatTime(current);
  el.fullDuration.textContent = formatTime(duration);
  if (duration > 0) el.fullSeekBar.value = String((current / duration) * 1000);
  if (lyricsViewActive) updateActiveLyricsLine(current);
};

player.onShuffleRepeatChange = (shuffle, repeat) => {
  el.shuffleBtn.classList.toggle("active", shuffle);
  el.repeatBtn.classList.toggle("active", repeat !== "off");
  el.repeatBtn.textContent = repeat === "one" ? "🔂" : "🔁";
};

// Real tag data read straight from the file (see id3.js) — only fires for
// whatever's currently playing, so it's safe to just overwrite the display.
player.onRealTags = (tags) => {
  if (tags.title) {
    el.nowPlayingTitle.textContent = tags.title;
    el.fullTitle.textContent = tags.title;
  }
  if (tags.artist) {
    el.nowPlayingArtist.textContent = tags.artist;
    el.fullArtist.textContent = tags.artist;
  }
  if (tags.pictureUrl) {
    el.miniArt.src = tags.pictureUrl;
    el.miniArt.classList.remove("hidden");
    el.miniArtFallback.classList.add("hidden");
    el.fullArt.src = tags.pictureUrl;
    el.fullArt.classList.remove("hidden");
    el.fullArtFallback.classList.add("hidden");
  }

  // player.js only guarantees this fires for whatever's still current, so
  // it's safe to trust queue[queueIndex] here (see the guard in playCurrent).
  currentRealTags = tags;
  if (resolveRealTagsPromise) {
    resolveRealTagsPromise(tags);
    resolveRealTagsPromise = null;
  }
};

// Restarts the CSS press animation even on rapid repeat taps (removing then
// re-adding the class in the same tick wouldn't retrigger it — the reflow
// forces the browser to notice).
function pulsePress(button) {
  button.classList.remove("btn-pressed");
  void button.offsetWidth;
  button.classList.add("btn-pressed");
}

el.miniPrevBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  pulsePress(el.miniPrevBtn);
  playPrevious();
});
el.miniPlayPauseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  playPause();
});
el.miniNextBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  pulsePress(el.miniNextBtn);
  playNext();
});
el.fullPlayPauseBtn.addEventListener("click", playPause);

// Hold-to-seek (full player only — the mini bar has no room/time context for
// scrubbing feedback, same reasoning most players use). A quick tap still
// just skips a track, matching before. While held past the threshold, it
// scrubs instead. The actual seek is deliberately stepped (every
// HOLD_SEEK_INTERVAL_MS) rather than continuous — tracks stream from a
// remote URL here, not a local file, so a real seek re-buffers over the
// network; committing on every animation frame would hammer that instead of
// feeling smooth. Only wired up if the Pointer Events API exists (it does on
// everything this app targets) — skipped harmlessly otherwise, falling back
// to plain click-to-skip via the listener below.
const HOLD_SEEK_THRESHOLD_MS = 450;
const HOLD_SEEK_STEP_SECONDS = 3;
const HOLD_SEEK_INTERVAL_MS = 300;

function wireHoldToSeek(button, direction, tapAction) {
  let holdTimer = null;
  let seekInterval = null;
  let isSeeking = false;

  function beginHold() {
    const duration = audioEl.duration;
    if (!duration || !isFinite(duration)) return; // nothing loaded to scrub through
    isSeeking = true;
    button.classList.add("btn-holding");
    seekInterval = setInterval(() => {
      const next = Math.min(Math.max(audioEl.currentTime + direction * HOLD_SEEK_STEP_SECONDS, 0), audioEl.duration || 0);
      seekTo(next);
    }, HOLD_SEEK_INTERVAL_MS);
  }

  function endHold() {
    clearTimeout(holdTimer);
    holdTimer = null;
    clearInterval(seekInterval);
    seekInterval = null;
    if (!isSeeking) return false;
    button.classList.remove("btn-holding");
    isSeeking = false;
    return true; // was a hold-seek, not a tap
  }

  button.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(beginHold, HOLD_SEEK_THRESHOLD_MS);
  });
  button.addEventListener("pointerup", () => {
    if (!endHold()) {
      pulsePress(button);
      tapAction();
    }
  });
  button.addEventListener("pointercancel", endHold);
  button.addEventListener("pointerleave", endHold);
}

if (window.PointerEvent) {
  wireHoldToSeek(el.fullNextBtn, 1, playNext);
  wireHoldToSeek(el.fullPrevBtn, -1, playPrevious);
} else {
  el.fullNextBtn.addEventListener("click", () => {
    pulsePress(el.fullNextBtn);
    playNext();
  });
  el.fullPrevBtn.addEventListener("click", () => {
    pulsePress(el.fullPrevBtn);
    playPrevious();
  });
}
el.fullSeekBar.addEventListener("input", () => {
  const duration = audioEl.duration || 0;
  if (duration > 0) seekTo((Number(el.fullSeekBar.value) / 1000) * duration);
});
el.shuffleBtn.addEventListener("click", toggleShuffle);
el.repeatBtn.addEventListener("click", cycleRepeat);

function openFullPlayer() {
  if (!queue[queueIndex]) return;
  el.fullPlayer.classList.remove("hidden");
}
function closeFullPlayer() {
  el.fullPlayer.classList.add("hidden");
  // Reopening always starts back on album art, not wherever lyrics view was
  // left — avoids surprising state the next time this is opened.
  if (lyricsViewActive) {
    lyricsViewActive = false;
    el.fullPlayerArt.classList.remove("hidden");
    el.lyricsPanel.classList.add("hidden");
    el.lyricsBtn.classList.remove("icon-active");
  }
}
el.fullPlayerCloseBtn.addEventListener("click", closeFullPlayer);
el.addToPlaylistBtn.addEventListener("click", () => {
  const track = queue[queueIndex];
  if (track) openAddToPlaylistModal(track);
});

// ---------- Up Next ----------
// Jumps within the CURRENT queue/play order (via playIndex) rather than
// replacing it with setQueue — tapping an upcoming track should just skip
// ahead to it, not turn "what's next" into a brand new queue.
function renderUpNextNowPlaying() {
  const current = queue[queueIndex];
  const hasCurrent = !!current;
  el.upNextNowLabel.classList.toggle("hidden", !hasCurrent);
  el.upNextNowRow.classList.toggle("hidden", !hasCurrent);
  if (!hasCurrent) return;
  const artist = current.audio && current.audio.artist;
  el.upNextNowRow.innerHTML = `
    <span class="row-lead">${EQUALIZER_ICON}</span>
    <div class="row-text">
      <div class="row-name">${escapeHtml(current.name.replace(/\.[^/.]+$/, ""))}</div>
      ${artist ? `<div class="row-sub">${escapeHtml(artist)}</div>` : ""}
    </div>
  `;
}

// Jumps within the CURRENT queue/play order (via playIndex) rather than
// replacing it with setQueue — tapping an upcoming track should just skip
// ahead to it, not turn "what's next" into a brand new queue.
function openUpNextView() {
  renderUpNextNowPlaying();
  const upcoming = getUpcomingTracks(Infinity);
  el.upNextList.innerHTML = "";
  if (upcoming.length === 0) {
    const msg = repeatMode === "one" ? "Repeat is set to this song only." : "Nothing queued after this.";
    el.upNextList.innerHTML = `<p class="status-msg">${msg}</p>`;
  }
  upcoming.forEach((track) => {
    el.upNextList.appendChild(
      trackRow(track, {
        reorderable: upcoming.length > 1,
        onPlay: () => {
          const idx = queue.indexOf(track);
          el.upNextOverlay.classList.add("hidden");
          if (idx !== -1) playIndex(idx);
        },
        onMenu: () => openAddToPlaylistModal(track),
      })
    );
  });
  if (upcoming.length > 1) enableQueueDragReorder(el.upNextList);
  el.upNextOverlay.classList.remove("hidden");
}
el.upNextBtn.addEventListener("click", openUpNextView);
el.upNextCloseBtn.addEventListener("click", () => el.upNextOverlay.classList.add("hidden"));

// ---------- Lyrics ----------
// LRCLIB (lrclib.net) is a free, keyless, crowd-sourced lyrics API — same
// "one small request for the currently-playing track only" pattern as
// findOnlineArtwork's iTunes lookup above. Cached per track id (storing the
// in-flight promise, same pattern as thumbnailCache in graph.js) so
// re-opening the panel for a track already seen this session doesn't refetch.
const lyricsCache = new Map();
let lyricsViewActive = false;
let currentLyrics = null; // { plain, synced: [{time,text}]|null, instrumental } for whatever's rendered now
// The real embedded tag read (id3.js), captured in player.onRealTags below —
// this is the exact title/artist actually shown on screen, and a more
// reliable match target than item.audio (OneDrive's lighter folder-listing
// metadata, which fetchLyricsResult falls back to when this isn't set yet).
let currentRealTags = null;
// Reset per track in onTrackChange, resolved once in onRealTags — lets a
// lyrics fetch that starts before the real tag arrives wait for it once
// instead of firing again reactively when it shows up (that was the
// double-fetch/double-"Loading lyrics…" bug).
let realTagsPromise = null;
let resolveRealTagsPromise = null;
let activeLyricsLineIndex = -1;

// Waits briefly for the real tag read to resolve (if one's in flight for the
// current track) rather than immediately settling for weaker metadata —
// bounded so a slow/failed tag read can't hang the lyrics fetch indefinitely.
function waitForRealTags(timeoutMs) {
  if (currentRealTags) return Promise.resolve(currentRealTags);
  if (!realTagsPromise) return Promise.resolve(null);
  return Promise.race([realTagsPromise, new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))]);
}

function parseSyncedLyrics(lrc) {
  const lines = [];
  const timeTag = /\[(\d{2}):(\d{2}(?:\.\d{1,3})?)\]/g;
  lrc.split("\n").forEach((line) => {
    const matches = [...line.matchAll(timeTag)];
    if (!matches.length) return;
    const text = line.replace(timeTag, "").trim();
    matches.forEach((m) => {
      lines.push({ time: parseInt(m[1], 10) * 60 + parseFloat(m[2]), text });
    });
  });
  return lines.sort((a, b) => a.time - b.time);
}

// Filenames rarely match LRCLIB's clean track titles verbatim — strips a
// leading track number ("03 - ", "03. ") and trailing tags that are clearly
// upload/quality noise, not part of the actual title ("(Official Video)",
// "[HD]", "(Lyrics)"). Loops so "Song (Official Video) [HD]" loses both.
// Deliberately conservative: things like "(Remix)" or "(feat. X)" are left
// alone since they're often genuinely part of the official title.
function cleanTrackTitle(name) {
  let t = name.replace(/^\s*(?:track\s*)?\d{1,3}[\s._-]+/i, "");
  const trailingTag = /\s*[([]([^()[\]]{1,60})[)\]]\s*$/;
  const noiseWords = /official|video|audio|lyrics?|visualizer|hd|4k|mv\b|kbps|flac|full album/i;
  let m;
  while ((m = t.match(trailingTag)) && noiseWords.test(m[1])) {
    t = t.slice(0, m.index);
  }
  return t.replace(/\s{2,}/g, " ").trim();
}

// "Artist A feat. Artist B" / "Artist A, Artist B" / "Artist A & Artist B"
// -> "Artist A" — LRCLIB's artist_name is the primary credited artist, and
// querying with the full collab string as a single name rarely matches.
function primaryArtist(artist) {
  return artist.split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bx\b|\bvs\.?\b)\s*/i)[0].trim();
}

function normalizeForCompare(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Plain Levenshtein edit distance — used so a real-world spelling variant
// (an extra/missing/swapped letter — e.g. a band tagged "La Etnnia" vs a
// file/query reading "La Etnia") still scores as a match. Substring
// containment (below) already covers the *other* common case, an extra
// qualifier word ("Los Inquietos" vs "Los Inquietos del Vallenato") — edit
// distance alone scores that poorly since the lengths differ a lot, so both
// checks are needed, not just one.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// Shared by title and artist comparisons in both scoreLyricsCandidate and
// scoreArtworkCandidate: exact match, a clean substring relationship, or a
// close spelling variant (>=85% similar) all count as a strong match;
// anything moderately close (>=65%) counts as a partial one.
function fieldMatchScore(want, got, exactPoints, partialPoints) {
  if (!want) return 0;
  const nWant = normalizeForCompare(want);
  const nGot = normalizeForCompare(got);
  if (!nGot) return 0;
  if (nGot === nWant) return exactPoints;
  // A one-character spelling variant on an otherwise-matching string is as
  // trustworthy as an exact match — kept as its own check rather than folded
  // into the substring one below, since it doesn't change the original
  // exact-vs-partial weighting for the substring case.
  if (similarity(nWant, nGot) >= 0.85) return exactPoints;
  if (nGot.includes(nWant) || nWant.includes(nGot) || similarity(nWant, nGot) >= 0.65) return partialPoints;
  return 0;
}

// Used only against /api/search results, which can return several loosely-
// matched candidates (covers, live versions, other songs with a similar
// title) — blindly trusting index 0 was a real source of wrong lyrics.
// Scores each candidate against what we actually asked for and only accepts
// the best one if it clears a minimum bar, rather than always showing
// *something*.
function scoreLyricsCandidate(candidate, wantTitle, wantArtist, wantDuration) {
  let score = 0;
  score += fieldMatchScore(wantTitle, candidate.trackName, 3, 1.5);
  score += fieldMatchScore(wantArtist, candidate.artistName, 3, 1.5);

  if (wantDuration && candidate.duration) {
    const diff = Math.abs(candidate.duration - wantDuration);
    if (diff <= 2) score += 2;
    else if (diff <= 6) score += 1;
    else if (diff > 20) score -= 2; // almost certainly a different recording
  }
  return score;
}

// A lone exact title match (worth 3) used to clear this on its own — the
// bug that showed unrelated Spanish rap lyrics for a vallenato track called
// "Casualidad" ("coincidence"): common enough as a title that it collides
// across genres, and with no artist tag on the file to corroborate against,
// title-only was the *only* signal available. Raised so an exact title match
// needs at least a partial second signal (artist or duration) to pass —
// title alone, or artist alone, is no longer enough by itself.
const LYRICS_MATCH_THRESHOLD = 4;

async function lrclibGet(params) {
  try {
    const res = await fetch(`https://lrclib.net/api/get?${params}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function lrclibSearch(params) {
  try {
    const res = await fetch(`https://lrclib.net/api/search?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function bestScoredMatch(results, wantTitle, wantArtist, wantDuration) {
  let best = null;
  let bestScore = -Infinity;
  for (const candidate of results) {
    const score = scoreLyricsCandidate(candidate, wantTitle, wantArtist, wantDuration);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore >= LYRICS_MATCH_THRESHOLD ? best : null;
}

// LRCLIB is a smaller, mostly community/synced-lyrics-focused database — some
// perfectly ordinary songs just aren't in it at all (not a matching problem,
// a coverage gap). lyrics.ovh is a free, keyless, plain-text-only lyrics API
// with broader mainstream/older-catalog coverage, tried only after LRCLIB's
// own 4-strategy cascade below has already come up completely empty. No
// synced timestamps, and no alternate candidates to score against (it's a
// direct lookup, not a search), so this is strictly a last resort.
async function lyricsOvhGet(artist, title) {
  try {
    const res = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.lyrics || null;
  } catch {
    return null;
  }
}

async function fetchLyricsResult(track) {
  // Prefer the real embedded tag (currentRealTags — the exact title/artist
  // shown on screen) over item.audio, OneDrive's lighter folder-listing
  // metadata that can be empty or wrong even when the real tag is fine. If
  // the tag read is still in flight for this track, wait up to 3s for it —
  // one fetch with the best available data, instead of fetching now and
  // potentially again once the real tag shows up.
  const realTags = queue[queueIndex] === track ? await waitForRealTags(3000) : null;

  const rawTitle = (realTags && realTags.title) || track.name.replace(/\.[^/.]+$/, "");
  const cleanTitle = cleanTrackTitle(rawTitle);
  const titleCandidates = [...new Set([cleanTitle, rawTitle])];

  const rawArtist = (realTags && realTags.artist) || (track.audio && track.audio.artist) || "";
  const artist = rawArtist ? primaryArtist(rawArtist) : "";
  const album = (realTags && realTags.album) || (track.audio && track.audio.album) || "";
  const duration = Math.round(audioEl.duration) || 0;

  let hit = null;

  // 1) Exact match on the cleaned title — most precise when it works.
  if (!hit && artist) {
    const params = new URLSearchParams({ track_name: cleanTitle, artist_name: artist });
    if (album) params.set("album_name", album);
    if (duration) params.set("duration", String(duration));
    hit = await lrclibGet(params);
  }
  // 2) Same, but without duration — covers a different reference recording
  //    (radio edit vs. album version) being a few seconds off.
  if (!hit && artist && duration) {
    const params = new URLSearchParams({ track_name: cleanTitle, artist_name: artist });
    if (album) params.set("album_name", album);
    hit = await lrclibGet(params);
  }
  // 3) Fuzzy search, scored — try each title candidate until one clears the
  //    confidence bar, instead of trusting whichever result LRCLIB ranks
  //    first.
  for (const title of titleCandidates) {
    if (hit) break;
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    const results = await lrclibSearch(params);
    hit = bestScoredMatch(results, cleanTitle, artist, duration);
  }
  // 4) Last resort: title only, no artist constraint (covers a missing/wrong
  //    artist tag) — still scored, so a low-confidence guess doesn't slip
  //    through as if it were a real match.
  if (!hit && artist) {
    const params = new URLSearchParams({ track_name: cleanTitle });
    const results = await lrclibSearch(params);
    hit = bestScoredMatch(results, cleanTitle, "", duration);
  }

  if (hit) {
    return {
      plain: hit.plainLyrics || null,
      synced: hit.syncedLyrics ? parseSyncedLyrics(hit.syncedLyrics) : null,
      instrumental: !!hit.instrumental,
    };
  }

  // 5) LRCLIB has nothing at all for this track — try the broader-coverage
  // plain-text fallback before giving up (see lyricsOvhGet above).
  const plainFallback = artist && cleanTitle ? await lyricsOvhGet(artist, cleanTitle) : null;
  return { plain: plainFallback, synced: null, instrumental: false };
}

function getLyricsForTrack(track) {
  if (lyricsCache.has(track.id)) return lyricsCache.get(track.id);
  const promise = fetchLyricsResult(track);
  lyricsCache.set(track.id, promise);
  return promise;
}

function renderLyricsPanel(lyrics) {
  activeLyricsLineIndex = -1;
  el.lyricsPanel.innerHTML = "";
  if (lyrics.instrumental) {
    el.lyricsPanel.innerHTML = `<p class="status-msg lyrics-empty">🎧 This track is instrumental — no lyrics.</p>`;
    return;
  }
  if (lyrics.synced && lyrics.synced.length) {
    lyrics.synced.forEach((line, i) => {
      const p = document.createElement("p");
      p.className = "lyrics-line";
      p.dataset.index = i;
      p.textContent = line.text || "♪";
      el.lyricsPanel.appendChild(p);
    });
    return;
  }
  if (lyrics.plain) {
    const p = document.createElement("p");
    p.className = "lyrics-plain";
    p.textContent = lyrics.plain;
    el.lyricsPanel.appendChild(p);
    return;
  }
  el.lyricsPanel.innerHTML = `<p class="status-msg lyrics-empty">No lyrics found for this song.</p>`;
}

async function showLyricsForCurrentTrack() {
  const track = queue[queueIndex];
  if (!track) return;
  currentLyrics = null;
  el.lyricsPanel.innerHTML = `<p class="status-msg lyrics-empty"><span class="spinner"></span>Loading lyrics…</p>`;
  try {
    const lyrics = await getLyricsForTrack(track);
    if (queue[queueIndex] !== track || !lyricsViewActive) return; // track/view changed while fetching
    currentLyrics = lyrics;
    renderLyricsPanel(lyrics);
  } catch (err) {
    if (queue[queueIndex] !== track || !lyricsViewActive) return;
    console.error("Lyrics lookup failed", err);
    el.lyricsPanel.innerHTML = `<p class="status-msg lyrics-empty">Couldn't load lyrics.</p>`;
  }
}

// Cheap linear scan (a synced lyric file is at most a couple hundred lines)
// run on the same timeupdate tick the seek bar already updates on — not a
// per-frame cost, and only does anything while the lyrics panel is open.
function updateActiveLyricsLine(current) {
  if (!currentLyrics || !currentLyrics.synced || !currentLyrics.synced.length) return;
  const lines = currentLyrics.synced;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= current) idx = i;
    else break;
  }
  if (idx === activeLyricsLineIndex) return;
  activeLyricsLineIndex = idx;
  const prevActive = el.lyricsPanel.querySelector(".lyrics-line.active");
  if (prevActive) prevActive.classList.remove("active");
  if (idx < 0) return;
  const lineEl = el.lyricsPanel.querySelector(`.lyrics-line[data-index="${idx}"]`);
  if (lineEl) {
    lineEl.classList.add("active");
    lineEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function toggleLyricsView() {
  lyricsViewActive = !lyricsViewActive;
  el.fullPlayerArt.classList.toggle("hidden", lyricsViewActive);
  el.lyricsPanel.classList.toggle("hidden", !lyricsViewActive);
  el.lyricsBtn.classList.toggle("icon-active", lyricsViewActive);
  if (lyricsViewActive) showLyricsForCurrentTrack();
}
el.lyricsBtn.addEventListener("click", toggleLyricsView);

// ---------- Swipe gestures ----------
// Taps are handled via a plain native "click" listener — that event is
// guaranteed by the browser to target the exact element the touch landed on
// (same as touchstart's target), so it can never "leak" to a different
// element underneath. Touch events here are used ONLY to detect an actual
// swipe (real finger movement past a threshold); once a swipe is confirmed
// we preventDefault so the browser doesn't also fire a trailing click.
function attachSwipe(element, handlers) {
  let startX = 0,
    startY = 0,
    tracking = false,
    swiped = false,
    ignore = false;

  element.addEventListener(
    "touchstart",
    (e) => {
      // .lyrics-panel is excluded too — it's the one scrollable area inside
      // the full player, and swipe-down-to-dismiss would otherwise hijack
      // any vertical drag past 15px (see touchmove below) before native
      // scrolling ever gets a chance to run.
      ignore = !!e.target.closest("button, input, .row-menu-btn, .lyrics-panel");
      if (ignore) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
      swiped = false;
    },
    { passive: true }
  );

  element.addEventListener(
    "touchmove",
    (e) => {
      if (ignore || !tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (!swiped && (Math.abs(dx) > 15 || Math.abs(dy) > 15)) {
        swiped = true;
      }
      if (swiped) e.preventDefault();
    },
    { passive: false }
  );

  element.addEventListener("touchend", (e) => {
    if (ignore || !tracking) return;
    tracking = false;
    if (!swiped) return; // plain tap — let the native click event handle it

    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDy > 60 && absDy > absDx * 1.2 && dy > 0) {
      handlers.onSwipeDown && handlers.onSwipeDown();
      return;
    }
    if (absDx > 60 && absDx > absDy * 1.2) {
      if (dx < 0) handlers.onSwipeLeft && handlers.onSwipeLeft();
      else handlers.onSwipeRight && handlers.onSwipeRight();
    }
  });

  if (handlers.onTap) {
    element.addEventListener("click", (e) => {
      if (e.target.closest("button, input, .row-menu-btn")) return;
      handlers.onTap();
    });
  }
}

attachSwipe(el.nowPlayingBar, {
  onTap: openFullPlayer,
  onSwipeLeft: playNext,
  onSwipeRight: playPrevious,
});

attachSwipe(el.fullPlayer, {
  onSwipeDown: closeFullPlayer,
});

// Swiping the album art itself (not the whole screen) skips tracks — same
// left/right convention as the mini-player bar above. Layering this on top
// of the full-player's own swipe-down listener is safe: each attachSwipe
// call tracks its own touch sequence independently, and a horizontal drag
// never satisfies that listener's vertical-dominant condition, so there's no
// double-handling of the same gesture.
attachSwipe(el.fullPlayerArt, {
  onSwipeLeft: playNext,
  onSwipeRight: playPrevious,
});

// ---------- Android back button ----------
// A PWA has no built-in back-stack, so without this the hardware/gesture
// back button just exits the app immediately no matter what's open. This
// makes it behave like a normal app: close whatever's on top first, then
// step up one folder level at a time, then exit once there's nothing left.
function handleBackPress() {
  if (selectMode) {
    exitSelectMode();
    return true;
  }
  if (!el.addPlaylistModal.classList.contains("hidden")) {
    el.addPlaylistModal.classList.add("hidden");
    return true;
  }
  if (!el.playlistActionsModal.classList.contains("hidden")) {
    el.playlistActionsModal.classList.add("hidden");
    return true;
  }
  if (!el.upNextOverlay.classList.contains("hidden")) {
    // Sits above the full player (it's opened from within it) — close this
    // first so back steps out one layer at a time, same as everything else.
    el.upNextOverlay.classList.add("hidden");
    return true;
  }
  if (!el.fullPlayer.classList.contains("hidden")) {
    closeFullPlayer();
    return true;
  }
  if (!el.detailOverlay.classList.contains("hidden")) {
    el.detailOverlay.classList.add("hidden");
    return true;
  }
  if (!el.folderPickerOverlay.classList.contains("hidden")) {
    // Step up one level within the picker itself first, same as the main
    // folder view — works in both onboarding and "change folder" mode, since
    // it never dismisses the picker, just navigates within it.
    if (fpStack.length > 1) {
      fpStack = fpStack.slice(0, -1);
      loadFpFolder(fpStack[fpStack.length - 1].id);
      return true;
    }
    // At the picker's own root: onboarding has no Cancel button — it's
    // mandatory, so back shouldn't be able to dismiss it there.
    if (!el.folderPickerCancelBtn.classList.contains("hidden")) {
      closeFolderPicker();
      return true;
    }
    return true; // onboarding, nothing to do, but still consume the back press
  }
  if (!el.settingsOverlay.classList.contains("hidden")) {
    el.settingsOverlay.classList.add("hidden");
    return true;
  }
  if (!el.playlistsOverlay.classList.contains("hidden")) {
    el.playlistsOverlay.classList.add("hidden");
    return true;
  }
  if (!el.searchOverlay.classList.contains("hidden")) {
    el.searchOverlay.classList.add("hidden");
    return true;
  }
  if (folderStack.length > 1) {
    folderStack = folderStack.slice(0, -1);
    openFolder(folderStack[folderStack.length - 1].id, false);
    return true;
  }
  // Nothing left to close and we're at the top of folder navigation.
  if (isNative()) {
    // Native convention: minimize like any normal Android app, rather than
    // killing the process or asking "are you sure" — there's a real task
    // switcher to bring it back from, unlike a website's back button.
    window.Capacitor.Plugins.App.minimizeApp();
    return true;
  }
  // Web has no "minimize" — this back press would actually leave the page,
  // so confirm first rather than letting one stray tap close everything.
  if (confirm("Exit NubePlayer?")) {
    return false; // let this back press go through and exit
  }
  return true; // stay — re-arm the guard for the next back press
}

// A pushState "guard" entry absorbs the back press (popstate fires without
// actually navigating anywhere); re-pushing it after handling one keeps
// absorbing back presses indefinitely until handleBackPress reports there's
// nothing left to close, at which point we stop re-pushing and the next
// back press exits the app for real.
// Only react to back presses once we've actually armed the guard ourselves —
// the Microsoft sign-in redirect can trigger a stray popstate while landing
// back on the app (before showApp() has run), which would otherwise hit the
// "nothing left to close" case and pop the exit-confirmation before the user
// has even seen the app yet.
let backGuardActive = false;

function pushBackGuard() {
  backGuardActive = true;
  history.pushState({ musicPlayerBackGuard: true }, "");
}

// Native's hardware back button doesn't naturally fire "popstate" the way a
// real browser's back button does — @capacitor/app's own default handling
// (when nothing else listens) just tries the WebView's own goBack()/history,
// bypassing all of the above entirely. Registering our own listener hands
// every press straight to handleBackPress() instead, no indirection.
if (isNative()) {
  window.Capacitor.Plugins.App.addListener("backButton", () => handleBackPress());
} else {
  window.addEventListener("popstate", () => {
    if (!backGuardActive) return;
    if (handleBackPress()) pushBackGuard();
  });
}

// Shows whatever was last playing (title/artist/colorful placeholder) without
// fetching anything — no download URL, no real thumbnail/ID3 read — so
// reopening the app doesn't spend data until you actually tap play.
function showRestoredTrackDisplay(item) {
  el.nowPlayingBar.classList.remove("hidden");
  const title = item.name.replace(/\.[^/.]+$/, "");
  const artist = (item.audio && item.audio.artist) || "OneDrive";
  el.nowPlayingTitle.textContent = title;
  el.nowPlayingArtist.textContent = artist;
  el.fullTitle.textContent = title;
  el.fullArtist.textContent = artist;
  el.miniArt.classList.add("hidden");
  el.miniArtFallback.classList.remove("hidden");
  el.fullArt.classList.add("hidden");
  el.fullArtFallback.classList.remove("hidden");
  paintFallbackArt(item);
  el.miniPlayPauseBtn.textContent = "▶";
  el.fullPlayPauseBtn.textContent = "▶";
}

// ---------- Auth / boot ----------
function showApp() {
  el.loginScreen.classList.add("hidden");
  el.appScreen.classList.remove("hidden");
  pushBackGuard();

  const restoredItem = restorePlaybackState();
  if (restoredItem) showRestoredTrackDisplay(restoredItem);

  const savedPath = getSavedFolderPath();
  if (!savedPath) {
    openFolderPicker("onboarding");
  } else {
    openMainFolderView(savedPath);
    ensureLibraryLoaded(); // quietly builds/refreshes the search index in the background — no need to open Search first
  }
}

function getSavedFolderPath() {
  try {
    const raw = localStorage.getItem(DEFAULT_FOLDER_KEY);
    if (!raw) return null;
    let stack = JSON.parse(raw);
    if (!Array.isArray(stack) || !stack.length) return null;
    if (stack.length > 1) {
      // Self-heal old saves made before the fix above — collapses a full
      // OneDrive-root-to-folder path down to just the chosen folder, so
      // existing users don't have to pick their folder again.
      stack = [stack[stack.length - 1]];
      localStorage.setItem(DEFAULT_FOLDER_KEY, JSON.stringify(stack));
    }
    return stack;
  } catch {
    return null;
  }
}

function showLogin() {
  el.loginScreen.classList.remove("hidden");
  el.appScreen.classList.add("hidden");
}

el.signInBtn.addEventListener("click", async () => {
  try {
    await signIn();
  } catch (err) {
    console.error("Sign-in failed", err);
    return;
  }
  // Web's signIn() navigates away (MSAL loginRedirect) before this matters;
  // native has no such reload, so the app screen needs to be shown explicitly
  // — without this, sign-in would silently succeed but leave you stuck on the
  // login screen until the next manual reopen of the app.
  if (getActiveAccount()) showApp();
});
el.signOutBtn.addEventListener("click", async () => {
  if (!confirm("Sign out of NubePlayer?")) return;
  // Full clean slate — in case whoever signs in next is a different account,
  // nothing about the previous one (which folder was chosen, its cached
  // library index, in-flight Graph folder listings, the queue/mini-player)
  // should carry over. Playlists and the color theme are device/user
  // preferences, not tied to a specific signed-in account, so those are
  // deliberately left alone.
  localStorage.removeItem("lastPlaybackState");
  localStorage.removeItem(DEFAULT_FOLDER_KEY);
  localStorage.removeItem(LIBRARY_CACHE_KEY);
  clearFolderListCache();
  libraryLoaded = false;
  resetPlayer();
  el.nowPlayingBar.classList.add("hidden");
  // Settings (where this button lives) is a separate fixed-position overlay
  // from #app-screen — showLogin() below only hides #app-screen, so without
  // this, Settings (or any other overlay left open) would still be sitting
  // on top of everything the next time showApp() runs, making it look like
  // sign-in "took you to Settings" instead of the folder view underneath.
  el.settingsOverlay.classList.add("hidden");
  el.searchOverlay.classList.add("hidden");
  el.playlistsOverlay.classList.add("hidden");
  el.detailOverlay.classList.add("hidden");
  el.fullPlayer.classList.add("hidden");
  await signOut();
  // Web's signOut() navigates away (MSAL logoutRedirect) before this matters;
  // native has no such reload, so the login screen needs to be shown explicitly
  // — without this the app just silently sat on the (now signed-out) app screen.
  showLogin();
});

ensureFavoritesPlaylist(); // local-only, no auth needed — safe before sign-in even resolves

(async function init() {
  const account = await initAuth();
  if (account) {
    showApp();
  } else {
    showLogin();
  }
})();

// Shown in Settings and on the login screen (el.loginVersionLabel) so a
// deploy/build can be visually confirmed instead of guessed at — same
// APP_VERSION constant on both web and native, since native has no service
// worker to ask.
el.appVersionLabel.textContent = APP_VERSION;
el.loginVersionLabel.textContent = APP_VERSION;

// Pointless inside the Capacitor app — there's nothing to cache, everything's
// already bundled locally — and Android WebView's service worker support is
// flaky enough there that registration just fails with a console warning.
if ("serviceWorker" in navigator && !(window.Capacitor && window.Capacitor.isNativePlatform())) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW registration failed", err));
  });
}
