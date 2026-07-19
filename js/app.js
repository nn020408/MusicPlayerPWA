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

  detailOverlay: document.getElementById("detail-overlay"),
  detailBackBtn: document.getElementById("detail-back-btn"),
  detailTitle: document.getElementById("detail-title"),
  detailList: document.getElementById("detail-list"),

  folderPickerOverlay: document.getElementById("folder-picker-overlay"),
  folderPickerHeading: document.getElementById("folder-picker-heading"),
  folderPickerCancelBtn: document.getElementById("folder-picker-cancel-btn"),
  fpHomeBtn: document.getElementById("fp-home-btn"),
  fpBreadcrumb: document.getElementById("fp-breadcrumb"),
  fpFileList: document.getElementById("fp-file-list"),
  fpUseHereBtn: document.getElementById("fp-use-here-btn"),

  toast: document.getElementById("toast"),

  nowPlayingBar: document.getElementById("now-playing-bar"),
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
  playlistActionsCancelBtn: document.getElementById("playlist-actions-cancel-btn"),

  upNextOverlay: document.getElementById("up-next-overlay"),
  upNextCloseBtn: document.getElementById("up-next-close-btn"),
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
function showToast(message, duration = 2500) {
  clearTimeout(toastHideTimer);
  clearTimeout(toastRemoveTimer);
  el.toast.textContent = message;
  el.toast.classList.remove("hidden");
  requestAnimationFrame(() => el.toast.classList.add("show"));
  toastHideTimer = setTimeout(() => {
    el.toast.classList.remove("show");
    toastRemoveTimer = setTimeout(() => el.toast.classList.add("hidden"), 200);
  }, duration);
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
function trackRow(track, { onPlay, onMenu, selectable = false }) {
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
  `;
  if (selectable && selectedItems.has(key)) row.classList.add("selected");

  const wasLongPress = selectable ? setupLongPress(row, () => {
    if (!selectMode) enterSelectMode();
    toggleItemSelection("track", track.id, track.name, track, row);
  }) : () => false;

  row.addEventListener("click", (e) => {
    if (e.target.closest(".row-menu-btn")) return;
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
    const { folders, tracks: folderTracks } = await listFolder(id);
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
  try {
    const { folders, tracks } = await listFolder(folderId);
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
  } catch (err) {
    console.error(err);
    el.statusMsg.textContent = "Couldn't load this folder. Check your connection and try again.";
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
  try {
    const { folders, tracks } = await listFolder(folderId);
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
    el.fpFileList.innerHTML = `<p class="status-msg">Couldn't load this folder. Check your connection and try again.</p>`;
  }
}

function openFolderPicker(mode) {
  fpStack = [{ id: "root", name: "OneDrive" }];
  el.folderPickerCancelBtn.classList.toggle("hidden", mode !== "change");
  el.folderPickerHeading.textContent = mode === "onboarding" ? "Select your music folder" : "Change music folder";
  el.folderPickerOverlay.classList.remove("hidden");
  loadFpFolder("root");
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
  el.folderPickerOverlay.classList.add("hidden");
  openMainFolderView([chosen]);
  ensureLibraryLoaded(); // covers first-time folder selection and later changes, not just later app opens
});

el.folderPickerCancelBtn.addEventListener("click", () => {
  el.folderPickerOverlay.classList.add("hidden");
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
    row.innerHTML = `
      <span class="row-icon">📃</span>
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
    row.innerHTML = `<span class="row-icon">📃</span><span class="row-name">${escapeHtml(pl.name)}</span>`;
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
el.settingsBtn.addEventListener("click", () => {
  el.libraryRootLabel.textContent = getLibraryRootLabel();
  // Don't clear scanStatus here — it already reflects reality (blank if
  // never scanned, live progress if scanning, or the "Done" summary), and
  // wiping it was erasing the auto-scan's result the moment you opened
  // Settings to go check it.
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

// Last resort: look up the song by artist/title in Apple's public music
// catalog. This is the only art source that leaves the app/OneDrive — it
// sends just the artist + title text, and it's a best-effort text match, so
// it can occasionally return the wrong cover for less common tracks.
async function findOnlineArtwork(title, artist) {
  const term = `${artist} ${title}`.trim();
  if (!term) return null;
  try {
    const res = await fetch(`https://itunes.apple.com/search?media=music&limit=1&term=${encodeURIComponent(term)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.results && data.results[0];
    if (!result || !result.artworkUrl100) return null;
    return result.artworkUrl100.replace("100x100", "600x600"); // ask for a bigger version than the default thumbnail
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

player.onTrackChange = (item) => {
  el.nowPlayingBar.classList.remove("hidden");
  const title = item.name.replace(/\.[^/.]+$/, "");
  const artist = (item.audio && item.audio.artist) || "OneDrive";
  el.nowPlayingTitle.textContent = title;
  el.nowPlayingArtist.textContent = artist;
  el.fullTitle.textContent = title;
  el.fullArtist.textContent = artist;
  updateNowPlayingRows();

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
};

player.onTimeUpdate = (current, duration) => {
  el.fullCurrentTime.textContent = formatTime(current);
  el.fullDuration.textContent = formatTime(duration);
  if (duration > 0) el.fullSeekBar.value = String((current / duration) * 1000);
};

player.onStatus = (msg) => {
  if (msg && msg.startsWith("Loading")) {
    el.statusMsg.innerHTML = `<span class="spinner"></span>${escapeHtml(msg)}`;
  } else {
    el.statusMsg.textContent = msg;
  }
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
};

el.miniPrevBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  playPrevious();
});
el.miniPlayPauseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  playPause();
});
el.miniNextBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  playNext();
});
el.fullPlayPauseBtn.addEventListener("click", playPause);
el.fullNextBtn.addEventListener("click", playNext);
el.fullPrevBtn.addEventListener("click", playPrevious);
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
function openUpNextView() {
  const upcoming = getUpcomingTracks(30);
  el.upNextList.innerHTML = "";
  if (upcoming.length === 0) {
    const msg = repeatMode === "one" ? "Repeat is set to this song only." : "Nothing queued after this.";
    el.upNextList.innerHTML = `<p class="status-msg">${msg}</p>`;
  }
  upcoming.forEach((track) => {
    el.upNextList.appendChild(
      trackRow(track, {
        onPlay: () => {
          const idx = queue.indexOf(track);
          el.upNextOverlay.classList.add("hidden");
          if (idx !== -1) playIndex(idx);
        },
        onMenu: () => openAddToPlaylistModal(track),
      })
    );
  });
  el.upNextOverlay.classList.remove("hidden");
}
el.upNextBtn.addEventListener("click", openUpNextView);
el.upNextCloseBtn.addEventListener("click", () => el.upNextOverlay.classList.add("hidden"));

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
      ignore = !!e.target.closest("button, input, .row-menu-btn");
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
      el.folderPickerOverlay.classList.add("hidden");
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
  // Nothing left to close and we're at the top of folder navigation — this
  // back press would actually exit the app, so confirm first rather than
  // letting one stray tap close everything.
  if (confirm("Exit MusicPlayer?")) {
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

window.addEventListener("popstate", () => {
  if (!backGuardActive) return;
  if (handleBackPress()) pushBackGuard();
});

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

el.signInBtn.addEventListener("click", () => signIn());
el.signOutBtn.addEventListener("click", () => {
  localStorage.removeItem("lastPlaybackState"); // don't carry over to whoever signs in next
  signOut();
});

(async function init() {
  const account = await initAuth();
  if (account) {
    showApp();
  } else {
    showLogin();
  }
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW registration failed", err));
  });
}
