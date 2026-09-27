// Multi-select in the main folder view: long-press (or the ☑️ button), then
// shuffle, queue or add the selection to a playlist.

import { el } from "../core/dom.js";
import { collectTracksRecursive } from "../data/library.js";
import { addToQueue, playCurrent, setQueue, shuffleOn, toggleShuffle } from "../player/player.js";
import { currentFolders, currentTracks } from "../state/browse.js";
import { showToast } from "./toast.js";
import { openAddToPlaylistModal } from "./addToPlaylist.js";

// Deliberately scoped to the main folder browser (#file-list), not Search or
// a playlist's detail view: those already have their own per-track "add to
// playlist" via the row menu, and selection state here is tied to
// currentFolders/currentTracks (see openFolder below), which only exist for
// the main view. Keeping it scoped avoids touching that other code at all.
const LONG_PRESS_MS = 480;

export let selectMode = false;

export const selectedItems = new Map();

 // "folder:id" | "track:id" -> { type, id, name, data }

export function selectKey(type, id) {
  return type + ":" + id;
}

// Wires press-and-hold on a row: shows a sweeping fill while held (cancels
// cleanly on early release or on scroll-intent movement), then fires
// onLongPress once the threshold is reached. Returns a function the row's
// own click handler must call first — it reports (and consumes) whether
// this click was actually the tail end of a long press, so that release
// doesn't also trigger the row's normal tap action.
export function setupLongPress(row, onLongPress) {
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

export function toggleItemSelection(type, id, name, data, row) {
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

export function enterSelectMode() {
  if (selectMode) return;
  selectMode = true;
  el.fileList.classList.add("select-mode");
  el.topBar.classList.add("hidden");
  el.selectHeaderBar.classList.remove("hidden");
  el.nowPlayingBar.classList.add("select-mode-hidden");
  updateSelectBarUI();
}

export function exitSelectMode() {
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

el.selectAddQueueBtn.addEventListener("click", async () => {
  const selectionCount = selectedItems.size;
  showToast(`Loading ${selectionCount} selection${selectionCount === 1 ? "" : "s"}…`);
  try {
    const tracks = await resolveSelectedTracks();
    exitSelectMode();
    if (tracks.length === 0) {
      showToast("No songs found in that selection");
      return;
    }
    addToQueue(tracks);
    showToast(`Added ${tracks.length} song${tracks.length === 1 ? "" : "s"} to queue`);
  } catch (err) {
    console.error(err);
    exitSelectMode();
    showToast("Couldn't load that selection");
  }
});