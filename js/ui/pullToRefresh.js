// Pull down from the top of the folder list to refresh: the strip above the list
// grows with your finger, and letting go re-reads the whole library from OneDrive
// (the same full rescan as Settings' "Rescan library") and reloads the folder on
// screen. Files deleted in OneDrive stop showing up and stop being played, and
// new ones appear. Artists already read for songs that still exist are kept, so
// this only re-lists the folders rather than reading every song's tags again.

import { el } from "../core/dom.js";
import { folderPathOf, getLibraryRootId, isScanning } from "../data/library.js";
import { currentFolder } from "../state/browse.js";
import { reloadCurrentFolder } from "./folderView.js";
import { rescanLibrary } from "./libraryWork.js";

// What's on screen decides how much to re-read: inside a folder (at any depth)
// only that folder and what's beneath it; on the top-level list, the whole library.
function scopeOnScreen() {
  const folder = currentFolder();
  if (!folder || folder.id === getLibraryRootId()) return null;
  const path = folderPathOf(folder.id);
  return path === undefined ? null : { folderId: folder.id, path };
}

const PULL_START_PX = 8; // ignore tiny movements (a tap, a normal scroll)
const PULL_STRETCH = 0.6; // the strip grows slower than the finger, like a real pull
const PULL_MAX_PX = 96; // the strip stops growing past this
const PULL_TRIGGER_PX = 56; // how far the strip must be pulled before letting go refreshes
const PULL_REFRESHING_PX = 48; // how tall the strip stays while spinning

let startY = null;
let pullPx = 0;
let refreshing = false;

function setHeight(px, animate) {
  pullPx = px;
  el.pullRefresh.classList.toggle("animating", !!animate);
  el.pullRefresh.style.height = `${px}px`;
}

async function refresh() {
  refreshing = true;
  el.pullRefresh.classList.add("refreshing");
  setHeight(PULL_REFRESHING_PX, true);
  try {
    if (!isScanning) await rescanLibrary(scopeOnScreen());
    reloadCurrentFolder();
  } finally {
    refreshing = false;
    el.pullRefresh.classList.remove("refreshing");
    setHeight(0, true);
  }
}

function endPull() {
  const startedHere = startY !== null;
  startY = null;
  if (!startedHere || refreshing) return;
  if (pullPx >= PULL_TRIGGER_PX) refresh();
  else setHeight(0, true);
}

el.fileList.addEventListener(
  "touchstart",
  (e) => {
    // Only starts when the list is already scrolled to its very top.
    if (refreshing || el.fileList.scrollTop > 0 || e.touches.length !== 1) {
      startY = null;
      return;
    }
    startY = e.touches[0].clientY;
  },
  { passive: true }
);

el.fileList.addEventListener(
  "touchmove",
  (e) => {
    if (startY === null || refreshing) return;
    const dy = e.touches[0].clientY - startY;
    if (dy < PULL_START_PX) {
      if (pullPx) setHeight(0, false);
      return;
    }
    setHeight(Math.min(PULL_MAX_PX, (dy - PULL_START_PX) * PULL_STRETCH), false);
  },
  { passive: true }
);

el.fileList.addEventListener("touchend", endPull, { passive: true });
el.fileList.addEventListener("touchcancel", endPull, { passive: true });
